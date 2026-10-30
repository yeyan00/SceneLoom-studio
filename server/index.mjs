import http from "node:http";
import path from "node:path";
import os from "node:os";
import { promises as fs, createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateOperation } from "../shared/edits.mjs";
import { validateWorkspace } from "../shared/workspace.mjs";
import { openProject, closeProjects } from "./project-store.mjs";
import { datasetIdentity } from "./dataset-identity.mjs";
import { createPackageManager, scanProjects } from "./project-packages.mjs";
import { createLogger } from "./logs.mjs";
import { loadTools, describeTool, toolArguments } from "./tools.mjs";
import { createChmJobs } from "./chm/jobs.mjs";
import { createLabelLibrary } from "./label-sets.mjs";
import { validateLabelSession } from "../shared/label-sets.mjs";
import { createSplatStore } from "./splats.mjs";
import { createTilesStore } from "./tiles.mjs";
import { readCollection, collectionForFile } from "./project-collection.mjs";
import { dataTypes } from "../shared/data-types.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stateDir =
  process.env.SCENELOOM_HOME || path.join(os.homedir(), ".sceneloom-studio");
await fs.mkdir(stateDir, { recursive: true });
const logger = await createLogger(path.join(stateDir, "logs"));
const chmJobs = createChmJobs(logger);
const labelLibrary = createLabelLibrary(stateDir);
const splats = createSplatStore(stateDir);
const restoredSplats = await splats.restore();
const tiles = createTilesStore(stateDir);
const restoredTiles = await tiles.restore();
const packages = createPackageManager({ stateDir, logger });
const toolDirectory =
  process.env.SCENELOOM_TOOLS || path.join(root, "tools", "plugins");
const executableTools = await loadTools(toolDirectory, logger);
const datasets = new Map(),
  jobs = new Map();
let settings = { storageMode: "adjacent", dataDirectory: "" },
  registry = {};
async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
settings = await readJSON(path.join(stateDir, "settings.json"), settings);
registry = await readJSON(path.join(stateDir, "registry.json"), {});
let writes = Promise.resolve();
function atomicJSON(file, value) {
  const body = JSON.stringify(value, null, 2);
  const job = writes.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, file);
  });
  writes = job.catch(() => {});
  return job;
}
const digest = (value) => createHash("sha256").update(value).digest("hex");
async function register(input, indexPath, originalSource) {
  let folder = path.resolve(input);
  if ((await fs.stat(folder)).isFile()) folder = path.dirname(folder);
  if (!indexPath) {
    const candidate = path.join(folder, "project.sceneloom.json");
    if (await readJSON(candidate, null)) indexPath = candidate;
    else {
      for (const candidate of [
        path.join(path.dirname(folder), "project.sceneloom.json"),
        path.join(folder + ".sceneloom", "project.sceneloom.json"),
      ]) {
        const entry = await readJSON(candidate, null);
        if (
          entry?.dataset?.source &&
          path.resolve(path.dirname(candidate), entry.dataset.source) === folder
        ) {
          indexPath = candidate;
          break;
        }
      }
    }
  }
  const expected = indexPath
    ? (await readJSON(indexPath, null))?.dataset
    : null;
  const {
    metadataText: metaText,
    metadata: meta,
    stats,
    revision,
  } = await datasetIdentity(folder, expected);
  if (
    meta.version !== "2.0" ||
    !["DEFAULT", "UNCOMPRESSED"].includes(meta.encoding)
  )
    throw new Error(
      "当前仅支持 Potree 2.0 DEFAULT/UNCOMPRESSED，BROTLI 将在后续接入。",
    );
  if (!meta.boundingBox || !meta.attributes?.some((a) => a.name === "position"))
    throw new Error("无效的点云元数据");
  const id = expected?.id || digest(folder + revision).slice(0, 24);
  const store = await openProject({
    stateDir,
    id,
    folder,
    revision,
    metadata: meta,
    indexPath,
    originalSource,
    projectDirectory: process.env.SCENELOOM_PROJECT_ROOT
      ? path.join(process.env.SCENELOOM_PROJECT_ROOT, id)
      : folder + ".sceneloom",
  });
  const { saved: state, session, recovered } = store.load();
  const ds = {
    id,
    folder,
    revision,
    meta,
    metadataText: metaText,
    fileStats: Object.fromEntries(
      ["hierarchy.bin", "octree.bin"].map((n, i) => [
        n,
        { size: stats[i].size, mtimeMs: stats[i].mtimeMs },
      ]),
    ),
    saved: state,
    session,
    store,
  };
  datasets.set(id, ds);
  return {
    id,
    revision,
    metadata: meta,
    session: ds.session,
    recovered,
    projectPath: store.entry,
    folder,
  };
}
async function sourceIdentity(file) {
  const s = await fs.stat(file);
  return digest(path.resolve(file) + `:${s.size}:${s.mtimeMs}`);
}
async function inspect(input, expected = "auto", allowCollection = true) {
  if (
    !["auto", "pointcloud", "gaussian", "tiles", "project"].includes(expected)
  )
    throw new Error("无效的数据类型");
  const ensureType = (type) => {
    if (expected !== "auto" && expected !== type)
      throw new Error(
        "文件内容与所选数据类型不匹配，请选择自动识别或正确的数据类型",
      );
  };
  const absolute = path.resolve(input),
    stat = await fs.stat(absolute);
  if (stat.isFile() && /\.sceneloom\.json$/i.test(absolute)) {
    ensureType("project");
    if (stat.size > 1024 * 1024) throw new Error("项目文件过大");
    const index = await readJSON(absolute, null);
    if (index?.format === "SceneLoom" && index.version === 2) {
      if (!allowCollection) throw new Error("项目数据不能引用另一个多数据项目");
      const collection = await readCollection(absolute),
        results = [],
        unavailable = [];
      for (const resource of collection.resources) {
        try {
          const source = path.resolve(path.dirname(absolute), resource.path);
          // Point cloud references use their v1 project to retain edit histories.
          const result = await inspect(
            source,
            /\.sceneloom\.json$/i.test(source) && resource.type === "pointcloud"
              ? "project"
              : resource.type,
            false,
          );
          if (result.kind === "convert")
            throw new Error("项目点云引用必须是已转换的数据");
          if (
            (result.kind === "potree" ? "pointcloud" : result.kind) !==
            resource.type
          )
            throw new Error("项目数据类型不匹配");
          results.push(result);
        } catch (error) {
          unavailable.push({
            type: resource.type,
            path: path.resolve(path.dirname(absolute), resource.path),
            error: error.message,
          });
        }
      }
      return { kind: "project", path: absolute, results, unavailable };
    }
  }
  if (stat.isDirectory()) {
    try {
      await fs.access(path.join(absolute, "tileset.json"));
      ensureType("tiles");
      return { kind: "tiles", view: await tiles.open(absolute) };
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  if (
    stat.isFile() &&
    /\.json$/i.test(absolute) &&
    !/\.sceneloom\.json$/i.test(absolute) &&
    path.basename(absolute).toLowerCase() !== "metadata.json"
  ) {
    if (stat.size > 32 * 1024 * 1024) throw new Error("JSON 数据入口文件过大");
    const content = await readJSON(absolute, null);
    if (!content?.asset || !content.root)
      throw new Error(
        "此 JSON 不是有效的 3D Tiles 入口；当前点云支持 Potree 2.0 metadata.json，不支持旧版 cloud.json",
      );
    ensureType("tiles");
    return { kind: "tiles", view: await tiles.open(absolute) };
  }
  if (stat.isFile() && /\.(ply|ssproj)$/i.test(absolute)) {
    ensureType("gaussian");
    return { kind: "gaussian", view: await splats.open(absolute) };
  }
  if (/\.sceneloom\.json$/i.test(absolute)) {
    const index = await readJSON(absolute, null);
    if (
      !index ||
      index.format !== "SceneLoom" ||
      index.version !== 1 ||
      typeof index.dataset?.source !== "string"
    )
      throw new Error("无效的工程文件");
    return {
      kind: "potree",
      dataset: await register(
        path.resolve(path.dirname(absolute), index.dataset.source),
        absolute,
      ),
    };
  }
  if (
    stat.isDirectory() ||
    path.basename(absolute).toLowerCase() === "metadata.json"
  ) {
    ensureType("pointcloud");
    const entry = stat.isDirectory()
      ? path.join(absolute, "project.sceneloom.json")
      : null;
    if (entry && (await readJSON(entry, null)))
      return inspect(entry, "auto", allowCollection);
    return { kind: "potree", dataset: await register(absolute) };
  }
  if (!/\.(las|laz)$/i.test(absolute))
    throw new Error(
      "当前支持 Potree metadata.json/目录、LAS、LAZ 和 Gaussian PLY。",
    );
  ensureType("pointcloud");
  const handle = await fs.open(absolute, "r");
  try {
    const header = Buffer.alloc(107);
    const { bytesRead } = await handle.read(header, 0, 107, 0);
    if (bytesRead !== 107 || header.toString("ascii", 0, 4) !== "LASF")
      throw new Error("文件头不是有效的 LAS/LAZ");
  } finally {
    await handle.close();
  }
  const identity = await sourceIdentity(absolute);
  let record = registry[identity];
  const store =
    settings.storageMode === "custom"
      ? settings.dataDirectory
      : path.dirname(absolute);
  if (!store) throw new Error("请先在设置中指定数据目录");
  let assetDir = path.join(
    store,
    path.basename(absolute, path.extname(absolute)) + ".sceneloom",
  );
  const binding = await readJSON(path.join(assetDir, "asset.json"), null);
  if (binding && binding.identity !== identity)
    assetDir = path.join(
      store,
      path.basename(absolute, path.extname(absolute)) +
        "-" +
        identity.slice(0, 8) +
        ".sceneloom",
    );
  if (!record) record = await readJSON(path.join(assetDir, "asset.json"), null);
  if (record?.output) {
    try {
      return {
        kind: "potree",
        dataset: await register(record.output, undefined, absolute),
        reused: true,
      };
    } catch {
      /* show explicit conversion rather than silently replacing */
    }
  }
  return {
    kind: "convert",
    source: absolute,
    identity,
    assetDir,
    output: path.join(assetDir, "pointcloud"),
    bytes: stat.size,
  };
}
function publicJob(job, includeDataset = true) {
  return {
    id: job.id,
    status: job.status,
    log: job.log,
    error: job.error,
    dataset: includeDataset ? job.dataset : undefined,
    toolId: job.toolId,
    title: job.title,
    source: job.source,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
  };
}
function captureOutput(job, child) {
  let output = "";
  const flush = () => {
    if (output) {
      logger.write("info", "tool.output", output, {
        jobId: job.id,
        toolId: job.toolId,
      });
      output = "";
    }
  };
  const timer = setInterval(flush, 500);
  timer.unref();
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (b) => {
      const text = b.toString();
      job.log = (job.log + text).slice(-12000);
      output = (output + text).slice(-16000);
    });
  child.once("close", () => {
    clearInterval(timer);
    flush();
  });
}
async function runTool(tool, values) {
  const args = toolArguments(tool, values);
  await fs.access(tool.executable);
  const job = {
    id: randomUUID(),
    toolId: tool.id,
    title: tool.title,
    startedAt: Date.now(),
    status: "running",
    log: "",
  };
  jobs.set(job.id, job);
  logger.write("info", "task", "Task started", {
    jobId: job.id,
    toolId: tool.id,
  });
  const child = spawn(tool.executable, args, {
    cwd: path.dirname(tool.executable),
    windowsHide: true,
    shell: false,
  });
  job.child = child;
  captureOutput(job, child);
  child.on("error", (e) => (job.error = e.message));
  child.on("close", (code) => {
    job.finishedAt = Date.now();
    job.exitCode = code;
    job.status =
      job.status === "cancelling"
        ? "cancelled"
        : code === 0
          ? "succeeded"
          : "failed";
    if (job.status === "failed")
      job.error ||= `Process exited with code ${code}`;
    logger.write(
      job.status === "failed" ? "error" : "info",
      "task",
      `Task ${job.status}`,
      { jobId: job.id, toolId: tool.id, exitCode: code, error: job.error },
    );
  });
  return publicJob(job);
}
async function convert(source) {
  const info = await inspect(source);
  if (info.kind !== "convert") return { reused: true, dataset: info.dataset };
  if (
    [...jobs.values()].some(
      (j) => j.source === info.source && j.status === "running",
    )
  )
    throw new Error("该文件已在转换中");
  const exe =
    process.env.POTREE_CONVERTER ||
    path.join(
      root,
      "tools",
      "PotreeConverter_2.1.5_x64_windows",
      "PotreeConverter.exe",
    );
  await fs.access(exe);
  const job = {
    id: randomUUID(),
    status: "running",
    log: "",
    source: info.source,
    toolId: "builtin.potree",
    title: "Potree 转换",
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  const partial = `${info.output}.partial`,
    chunks = path.join(info.assetDir, ".work", job.id);
  await fs.mkdir(partial, { recursive: true });
  await fs.mkdir(chunks, { recursive: true });
  const child = spawn(
    exe,
    [
      info.source,
      "-o",
      partial,
      "--chunkdir",
      chunks,
      "--encoding",
      "UNCOMPRESSED",
    ],
    { cwd: path.dirname(exe), windowsHide: true },
  );
  job.child = child;
  logger.write("info", "task", "Conversion started", {
    jobId: job.id,
    source: info.source,
  });
  captureOutput(job, child);
  child.on("error", (e) => {
    job.error = e.message;
  });
  child.on("close", async (code) => {
    try {
      if (job.status === "cancelling") {
        job.status = "cancelled";
        return;
      }
      if (code !== 0) throw new Error(job.error || `转换器退出码 ${code}`);
      if ((await sourceIdentity(info.source)) !== info.identity)
        throw new Error("转换期间源文件已发生变化");
      await datasetIdentity(partial); // Validate without creating a database inside the staging data.
      await fs.rename(partial, info.output);
      const record = {
        source: info.source,
        identity: info.identity,
        output: info.output,
        tool: exe,
        encoding: "UNCOMPRESSED",
        createdAt: new Date().toISOString(),
      };
      await atomicJSON(path.join(info.assetDir, "asset.json"), record);
      registry[info.identity] = record;
      await atomicJSON(path.join(stateDir, "registry.json"), registry);
      job.dataset = await register(
        info.output,
        path.join(info.assetDir, "project.sceneloom.json"),
        info.source,
      );
      job.status = "succeeded";
    } catch (e) {
      job.status = "failed";
      job.error = e.message;
    } finally {
      job.finishedAt = Date.now();
      job.exitCode = code;
      logger.write(
        job.status === "failed" ? "error" : "info",
        "task",
        `Conversion ${job.status}`,
        { jobId: job.id, error: job.error },
      );
      await fs.rm(partial, { recursive: true, force: true });
      await fs.rm(chunks, { recursive: true, force: true });
    }
  });
  return publicJob(job);
}
async function body(req) {
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 8e6) throw new Error("请求过大");
  }
  return value ? JSON.parse(value) : {};
}
const port = Number(process.env.PORT || 5173);
const production = process.argv.includes("--production");
const desktopToken = process.env.SCENELOOM_DESKTOP_TOKEN || "";
const vite = production
  ? null
  : await (
      await import("vite")
    ).createServer({
      root,
      server: { middlewareMode: true },
      appType: "spa",
    });
const server = http.createServer(async (req, res) => {
  const activePort = server.address().port;
  const url = new URL(req.url, `http://127.0.0.1:${activePort}`);
  const json = (value, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  try {
    if (
      !["127.0.0.1", "localhost"].includes(
        (req.headers.host || "").split(":")[0],
      )
    )
      return json({ error: "Invalid host" }, 403);
    if (desktopToken) {
      if (
        url.pathname === "/" &&
        url.searchParams.get("desktop_token") === desktopToken
      ) {
        res.writeHead(302, {
          Location: "/",
          "Set-Cookie": `sceneloom_desktop=${desktopToken}; HttpOnly; SameSite=Strict; Path=/`,
          "Cache-Control": "no-store",
        });
        return res.end();
      }
      const authenticated =
        (req.headers.cookie || "")
          .split(";")
          .some(
            (value) => value.trim() === `sceneloom_desktop=${desktopToken}`,
          ) || req.headers.authorization === `Bearer ${desktopToken}`;
      if (!authenticated)
        return json({ error: "Desktop session required" }, 403);
    }
    if (url.pathname.startsWith("/api/")) {
      if (
        req.headers.origin &&
        ![
          `http://127.0.0.1:${activePort}`,
          `http://localhost:${activePort}`,
        ].includes(req.headers.origin)
      )
        return json({ error: "Invalid origin" }, 403);
      if (
        req.method === "POST" &&
        !req.headers["content-type"]?.startsWith("application/json")
      )
        return json({ error: "JSON required" }, 415);
      if (
        desktopToken &&
        url.pathname === "/api/desktop/shutdown" &&
        req.method === "POST"
      ) {
        json({ ok: true });
        setTimeout(shutdown, 50);
        return;
      }
      if (url.pathname === "/api/logs/export" && req.method === "GET") {
        const content = await logger.export();
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Content-Disposition": 'attachment; filename="sceneloom-logs.jsonl"',
          "Cache-Control": "no-store",
        });
        return res.end(content);
      }
      if (url.pathname === "/api/projects/scan" && req.method === "POST")
        return json(await scanProjects((await body(req)).directory));
      if (url.pathname === "/api/directories" && req.method === "POST") {
        const input = await body(req);
        const directory = input.path;
        const includeFiles = input.includeFiles === true;
        const type = input.type || "auto";
        if (
          includeFiles &&
          type !== "auto" &&
          !dataTypes.some((item) => item.id === type)
        )
          throw new Error("无效的数据类型");
        if (!directory) {
          const candidates =
            process.platform === "win32"
              ? Array.from(
                  { length: 26 },
                  (_, i) => String.fromCharCode(65 + i) + ":\\",
                )
              : ["/"];
          const roots = await Promise.all(
            candidates.map(async (candidate) => {
              try {
                if ((await fs.stat(candidate)).isDirectory())
                  return { name: candidate, path: candidate };
              } catch {}
              return null;
            }),
          );
          return json({
            path: "",
            parent: null,
            directories: roots.filter(Boolean),
            ...(includeFiles ? { files: [] } : {}),
          });
        }
        if (typeof directory !== "string" || !path.isAbsolute(directory))
          throw new Error("请选择有效的绝对数据目录");
        let resolved = await fs.realpath(directory);
        if ((await fs.stat(resolved)).isFile())
          resolved = path.dirname(resolved);
        const entries = await fs.readdir(resolved, { withFileTypes: true });
        const extensions = new Set(
          dataTypes
            .filter((item) => type === "auto" || item.id === type)
            .flatMap((item) => item.extensions),
        );
        return json({
          path: resolved,
          parent:
            path.dirname(resolved) === resolved ? null : path.dirname(resolved),
          directories: entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => ({
              name: entry.name,
              path: path.join(resolved, entry.name),
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          ...(includeFiles
            ? {
                files: entries
                  .filter(
                    (entry) =>
                      entry.isFile() &&
                      extensions.has(
                        path.extname(entry.name).slice(1).toLowerCase(),
                      ) &&
                      (type !== "project" ||
                        /\.sceneloom\.json$/i.test(entry.name)),
                  )
                  .map((entry) => ({
                    name: entry.name,
                    path: path.join(resolved, entry.name),
                  }))
                  .sort((a, b) => a.name.localeCompare(b.name)),
              }
            : {}),
        });
      }
      if (url.pathname === "/api/packages" && req.method === "POST")
        return json(packages.start(await body(req)));
      const packageMatch = url.pathname.match(
        /^\/api\/packages\/([\w-]+)(\/cancel)?$/,
      );
      if (packageMatch) {
        const result =
          packageMatch[2] && req.method === "POST"
            ? packages.cancel(packageMatch[1])
            : packages.get(packageMatch[1]);
        return result ? json(result) : json({ error: "任务不存在" }, 404);
      }
      if (url.pathname === "/api/logs") {
        if (req.method === "POST") {
          const entry = await body(req);
          if (
            !["info", "warn", "error"].includes(entry.level) ||
            typeof entry.message !== "string"
          )
            throw new Error("Invalid log entry");
          logger.write(entry.level, "ui", entry.message, {
            details: JSON.stringify(entry.context || {}).slice(0, 4000),
          });
          return json({ ok: true });
        }
        return json(
          logger.query({
            after: Math.max(0, Number(url.searchParams.get("after")) || 0),
            level: ["info", "warn", "error"].includes(
              url.searchParams.get("level"),
            )
              ? url.searchParams.get("level")
              : "",
            search: (url.searchParams.get("search") || "").slice(0, 200),
          }),
        );
      }
      if (url.pathname === "/api/label-sets") {
        if (req.method === "GET") return json(await labelLibrary.list());
        if (req.method === "POST")
          return json(await labelLibrary.update(await body(req)));
        return json({ error: "无效的标签库操作" }, 405);
      }
      if (url.pathname === "/api/tools" && req.method === "GET")
        return json({
          tools: [
            {
              id: "builtin.potree",
              title: "Potree 转换",
              description: "LAS / LAZ → 八叉树流式点云",
              category: ["格式转换", "点云转换"],
              kind: "builtin",
              action: "open-source",
            },
            {
              id: "builtin.logs",
              title: "查看日志",
              description: "操作、任务与错误记录",
              category: ["诊断工具"],
              kind: "builtin",
              action: "logs",
            },
            ...Array.from(executableTools.values(), describeTool),
          ],
        });
      const toolMatch = url.pathname.match(/^\/api\/tools\/([-\w.]+)\/run$/);
      if (toolMatch && req.method === "POST") {
        const tool = executableTools.get(toolMatch[1]);
        if (!tool) return json({ error: "Tool not found" }, 404);
        return json(await runTool(tool, (await body(req)).parameters || {}));
      }
      if (url.pathname === "/api/settings") {
        if (req.method === "POST") {
          const next = await body(req);
          if (
            !["adjacent", "custom"].includes(next.storageMode) ||
            (next.storageMode === "custom" &&
              !path.isAbsolute(next.dataDirectory || ""))
          )
            throw new Error("请选择有效的绝对数据目录");
          settings = {
            storageMode: next.storageMode,
            dataDirectory: next.dataDirectory || "",
          };
          await atomicJSON(path.join(stateDir, "settings.json"), settings);
        }
        return json(settings);
      }
      if (url.pathname === "/api/open" && req.method === "POST") {
        const input = await body(req),
          result = await inspect(input.path, input.type || "auto");
        logger.write("info", "dataset", "Data opened", {
          path: input.path,
          kind: result.kind,
          reused: !!result.reused,
        });
        return json(result);
      }
      if (url.pathname === "/api/project-collection" && req.method === "POST") {
        const input = await body(req);
        if (
          typeof input.path !== "string" ||
          !path.isAbsolute(input.path) ||
          !/\.sceneloom\.json$/i.test(input.path)
        )
          throw new Error("请选择以 .sceneloom.json 结尾的绝对项目路径");
        const file = path.resolve(input.path);
        const collection = collectionForFile(file, input.resources);
        // Never replace a point cloud's project entry or an unrelated JSON file.
        try {
          await readCollection(file);
        } catch (error) {
          if (error.code !== "ENOENT")
            throw new Error("目标文件不是多数据项目，请选择其他路径");
        }
        await atomicJSON(file, collection);
        return json({ path: file });
      }
      if (url.pathname === "/api/splats" && req.method === "GET")
        return json({
          views: splats.list(),
          unavailable: restoredSplats.unavailable,
        });
      if (url.pathname === "/api/tiles" && req.method === "GET")
        return json({
          views: tiles.list(),
          unavailable: restoredTiles.unavailable,
        });
      const tilesMatch = url.pathname.match(
        /^\/api\/tiles\/([\w-]+)\/(files\/(.+)|view-state|close)$/,
      );
      if (tilesMatch) {
        if (tilesMatch[3] && ["GET", "HEAD"].includes(req.method))
          return await tiles.stream(
            tilesMatch[1],
            decodeURIComponent(tilesMatch[3]),
            req,
            res,
          );
        if (tilesMatch[2] === "view-state" && req.method === "POST")
          return json(await tiles.update(tilesMatch[1], await body(req)));
        if (tilesMatch[2] === "close" && req.method === "POST")
          return json(await tiles.close(tilesMatch[1]));
        return json({ error: "Invalid tiles request" }, 405);
      }
      const splatMatch = url.pathname.match(
        /^\/api\/splats\/([\w-]+)\/(file|view-state|close)$/,
      );
      if (splatMatch) {
        if (splatMatch[2] === "file" && ["GET", "HEAD"].includes(req.method))
          return await splats.stream(splatMatch[1], req, res);
        if (splatMatch[2] === "view-state" && req.method === "POST")
          return json(await splats.update(splatMatch[1], await body(req)));
        if (splatMatch[2] === "close" && req.method === "POST")
          return json(await splats.close(splatMatch[1]));
        return json({ error: "无效的 3DGS 请求" }, 405);
      }
      if (url.pathname === "/api/convert" && req.method === "POST")
        return json(await convert((await body(req)).source));
      if (url.pathname === "/api/jobs" && req.method === "GET")
        return json({
          jobs: [...jobs.values()]
            .map((job) => publicJob(job, false))
            .sort((a, b) => b.startedAt - a.startedAt),
        });
      const jobMatch = url.pathname.match(/^\/api\/jobs\/([\w-]+)(\/cancel)?$/);
      if (jobMatch) {
        const job = jobs.get(jobMatch[1]);
        if (!job) return json({ error: "任务不存在" }, 404);
        if (jobMatch[2] && req.method === "POST" && job.status === "running") {
          job.status = "cancelling";
          logger.write("warn", "task", "Cancellation requested", {
            jobId: job.id,
          });
          if (process.platform === "win32")
            spawn("taskkill", ["/pid", String(job.child.pid), "/T", "/F"], {
              windowsHide: true,
            });
          else job.child.kill("SIGTERM");
        }
        return json(publicJob(job));
      }
      const chmMatch = url.pathname.match(
        /^\/api\/datasets\/([\w-]+)\/chm(?:\/([\w-]+)(?:\/(cancel|result|apply))?)?$/,
      );
      if (chmMatch) {
        const ds = datasets.get(chmMatch[1]);
        if (!ds) return json({ error: "请重新打开数据" }, 404);
        if (!chmMatch[2] && req.method === "POST")
          return json(await chmJobs.start(ds, await body(req)));
        if (
          chmMatch[2] &&
          ((req.method === "GET" &&
            !["cancel", "apply"].includes(chmMatch[3])) ||
            (req.method === "POST" &&
              ["cancel", "apply"].includes(chmMatch[3])))
        )
          return json(await chmJobs.handle(ds, chmMatch[2], chmMatch[3]));
        return json({ error: "无效的 CHM 请求" }, 405);
      }
      const match = url.pathname.match(
        /^\/api\/datasets\/([\w-]+)\/(files\/(metadata.json|hierarchy.bin|octree.bin)|session|save|backup|tree-id)$/,
      );
      if (!match) return json({ error: "接口不存在" }, 404);
      const ds = datasets.get(match[1]);
      if (!ds) return json({ error: "请重新打开数据" }, 404);
      if (match[2] === "tree-id" && req.method === "POST")
        return json({
          treeId: ds.store.allocateTreeId((await body(req)).valueType),
        });
      if (match[2] === "backup" && req.method === "POST")
        return json({
          path: await ds.store.backupTo((await body(req)).directory),
        });
      if (match[3]) {
        const file = path.join(ds.folder, match[3]),
          stat = await fs.stat(file);
        const original = ds.fileStats[match[3]];
        if (
          original &&
          (original.size !== stat.size || original.mtimeMs !== stat.mtimeMs)
        )
          return json(
            { error: "源点云发生变化，请重新打开；旧编辑不能自动套用。" },
            409,
          );
        let start = 0,
          end = stat.size - 1,
          status = 200;
        if (req.headers.range) {
          const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
          if (!range) {
            res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
            return res.end();
          }
          start = Number(range[1]);
          end = range[2] ? Number(range[2]) : end;
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start > end ||
            end >= stat.size
          ) {
            res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
            return res.end();
          }
          status = 206;
        }
        res.writeHead(status, {
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Type": match[3].endsWith("json")
            ? "application/json"
            : "application/octet-stream",
          "Cache-Control": "no-cache",
          ...(status === 206
            ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` }
            : {}),
        });
        const stream = createReadStream(file, { start, end });
        stream.on("error", () => res.destroy());
        res.on("close", () => stream.destroy());
        return stream.pipe(res);
      }
      if (req.method === "GET") return json(ds.session);
      const next = await body(req);
      if (
        next.sourceRevision !== ds.revision ||
        !Array.isArray(next.operations) ||
        !Number.isInteger(next.cursor) ||
        next.cursor < 0 ||
        next.cursor > next.operations.length
      )
        throw new Error("编辑版本或历史无效");
      next.operations.forEach(validateOperation);
      validateWorkspace(next.workspace);
      validateLabelSession(next);
      if (
        next.classes !== undefined &&
        (!Array.isArray(next.classes) ||
          next.classes.length > 256 ||
          next.classes.some(
            (c) =>
              !Number.isInteger(c.id) ||
              c.id < 0 ||
              c.id > 255 ||
              typeof c.name !== "string" ||
              c.name.length > 120 ||
              !/^#[\da-f]{6}$/i.test(c.color),
          ))
      )
        throw new Error("类别定义无效");
      // Verify source identity at save time too, even if the client has no new range reads.
      if (
        (await fs.readFile(path.join(ds.folder, "metadata.json"), "utf8")) !==
        ds.metadataText
      )
        return json(
          { error: "源点云发生变化，请重新打开；旧编辑不能自动套用。" },
          409,
        );
      for (const [name, original] of Object.entries(ds.fileStats)) {
        const current = await fs.stat(path.join(ds.folder, name));
        if (
          current.size !== original.size ||
          current.mtimeMs !== original.mtimeMs
        )
          return json(
            { error: "源点云发生变化，请重新打开；旧编辑不能自动套用。" },
            409,
          );
      }
      ds.session = ds.store.save(next, match[2] === "save");
      if (match[2] === "save") {
        logger.write("info", "project", "Project saved", {
          datasetId: ds.id,
          operations: next.cursor,
        });
        ds.saved = ds.session;
      }
      return json(ds.session);
    }
    if (vite) return vite.middlewares(req, res);
    const requested = path.resolve(
      root,
      "dist",
      "." + decodeURIComponent(url.pathname),
    );
    const base = path.join(root, "dist");
    if (!requested.startsWith(base + path.sep) && requested !== base) {
      res.writeHead(403);
      return res.end();
    }
    let file = requested;
    try {
      if (!(await fs.stat(file)).isFile()) file = path.join(base, "index.html");
    } catch {
      file = path.join(base, "index.html");
    }
    const mime = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript",
      ".mjs": "text/javascript",
      ".css": "text/css",
      ".wasm": "application/wasm",
      ".json": "application/json; charset=utf-8",
    };
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] || "application/octet-stream",
    );
    createReadStream(file).pipe(res);
  } catch (e) {
    logger.write("error", "api", e.message, {
      method: req.method,
      route: url.pathname,
      stack: e.stack?.slice(0, 4000),
    });
    if (!res.headersSent) json({ error: e.message }, 400);
    else res.destroy();
  }
});
server.listen(port, "127.0.0.1", () => {
  const activePort = server.address().port;
  logger.write("info", "application", "Service started", { port: activePort });
  console.log(`SceneLoom http://127.0.0.1:${activePort}`);
});
function shutdown() {
  chmJobs.close();
  server.close();
  closeProjects();
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
