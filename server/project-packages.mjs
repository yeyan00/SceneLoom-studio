import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  lstat,
  realpath,
  writeFile,
  rename,
  rm,
  utimes,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import { openProject } from "./project-store.mjs";
import { datasetIdentity, pointFiles, digest } from "./dataset-identity.mjs";

const entryName = "project.sceneloom.json";
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};
async function readEntry(file) {
  const value = JSON.parse(await readFile(file, "utf8"));
  if (
    value.format !== "SceneLoom" ||
    value.version !== 1 ||
    !value.dataset?.id ||
    typeof value.dataset.source !== "string" ||
    !["project.db", "project.sqlite"].includes(value.database)
  )
    throw new Error("无效的工程文件");
  return value;
}
function safeName(value) {
  let name =
    value
      .replace(/\.sceneloom$/i, "")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 100) || "Project";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = "_" + name;
  return name;
}
async function fileRecord(source, relative) {
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("工程依赖必须是普通文件");
  return { source, relative, size: info.size, mtimeMs: info.mtimeMs };
}
async function attributeFiles(root) {
  const result = [];
  try {
    if ((await lstat(path.join(root, "attributes"))).isSymbolicLink())
      throw new Error("扩展属性目录不能包含符号链接");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  async function walk(directory, relative = "attributes") {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink())
        throw new Error("扩展属性目录不能包含符号链接");
      const child = path.join(directory, entry.name),
        target = path.join(relative, entry.name);
      if (entry.isDirectory()) await walk(child, target);
      else result.push(await fileRecord(child, target));
    }
  }
  await walk(path.join(root, "attributes"));
  return result;
}
export async function scanProjects(directory) {
  if (!path.isAbsolute(directory || ""))
    throw new Error("请选择有效的绝对数据目录");
  const root = await realpath(directory),
    projects = [];
  let visited = 0,
    truncated = false;
  async function walk(folder, depth) {
    if (depth > 6 || ++visited > 5000 || projects.length >= 500) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (error) {
      if (folder === root) throw error;
      return;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".sceneloom.json")) {
        const file = path.join(folder, entry.name);
        try {
          const index = await readEntry(file);
          projects.push({
            path: file,
            name: path.basename(folder),
            hasOriginal: !!index.originalSource?.path,
          });
        } catch {
          /* Other JSON files are not projects. */
        }
      }
    }
    for (const entry of entries)
      if (
        entry.isDirectory() &&
        ![
          "node_modules",
          ".git",
          "pointcloud",
          "attributes",
          ".work",
          "original",
        ].includes(entry.name)
      )
        await walk(path.join(folder, entry.name), depth + 1);
  }
  await walk(root, 0);
  return {
    projects: projects.sort((a, b) => a.path.localeCompare(b.path)),
    truncated,
  };
}
export function createPackageManager({
  stateDir,
  logger,
  copyHighWaterMark = 1024 * 1024,
} = {}) {
  const jobs = new Map();
  const publicJob = (job) => ({
    id: job.id,
    status: job.status,
    completedBytes: job.completedBytes,
    totalBytes: job.totalBytes,
    items: job.items.map(({ controller, ...item }) => item),
  });
  async function reserve(root, name, collision) {
    for (let i = 0; i < 10000; i++) {
      const target = path.resolve(
        root,
        `${name}${i ? " (" + (i + 1) + ")" : ""}.sceneloom`,
      );
      if (!inside(root, target)) throw new Error("无效的打包路径");
      try {
        await mkdir(target);
        return target;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (collision === "skip") return null;
      }
    }
    throw new Error("同名工程过多，请更换目标目录");
  }
  async function prepare(entry, target) {
    const index = await readEntry(entry),
      directory = await realpath(path.dirname(entry)),
      folder = await realpath(path.resolve(directory, index.dataset.source));
    if (inside(directory, target) || inside(folder, target))
      throw new Error("目标目录不能位于源工程或点云目录内");
    const identity = await datasetIdentity(folder, index.dataset);
    const store = await openProject({
      stateDir,
      id: index.dataset.id,
      folder,
      revision: identity.revision,
      metadata: identity.metadata,
      indexPath: entry,
    });
    const files = await Promise.all(
      pointFiles.map((name) =>
        fileRecord(path.join(folder, name), path.join("pointcloud", name)),
      ),
    );
    for (let i = 0; i < identity.stats.length; i++)
      if (
        files[i + 1].size !== identity.stats[i].size ||
        files[i + 1].mtimeMs !== identity.stats[i].mtimeMs
      )
        throw new Error("打包期间源文件发生变化");
    files.push(...(await attributeFiles(directory)));
    return {
      entry,
      directory,
      folder,
      index: store.index,
      identity,
      store,
      files,
      name: safeName(path.basename(directory)),
    };
  }
  async function copyFile(record, target, job, signal) {
    signal.throwIfAborted();
    await mkdir(path.dirname(target), { recursive: true });
    const current = await stat(record.source);
    if (current.size !== record.size || current.mtimeMs !== record.mtimeMs)
      throw new Error("打包期间源文件发生变化");
    const hash = createHash("sha256");
    await pipeline(
      createReadStream(record.source, { highWaterMark: copyHighWaterMark }),
      new Transform({
        transform(chunk, encoding, callback) {
          hash.update(chunk);
          job.completedBytes += chunk.length;
          callback(null, chunk);
        },
      }),
      createWriteStream(target, { flags: "wx" }),
      { signal },
    );
    const after = await stat(record.source);
    if (after.size !== record.size || after.mtimeMs !== record.mtimeMs)
      throw new Error("打包期间源文件发生变化");
    await utimes(target, current.atime, current.mtime);
    const copied = await stat(target);
    if (copied.size !== record.size) throw new Error("打包文件长度校验失败");
    return {
      size: copied.size,
      mtimeMs: copied.mtimeMs,
      sha256: hash.digest("hex"),
    };
  }
  async function execute(job, options) {
    const staged = [];
    try {
      await mkdir(options.destination, { recursive: true });
      const root = await realpath(options.destination);
      job.status = "preparing";
      // Capture all small database snapshots before starting potentially long data copies.
      for (const item of job.items) {
        if (job.controller.signal.aborted) break;
        try {
          const prepared = await prepare(item.projectPath, root);
          if (options.includeOriginal && prepared.index.originalSource?.path) {
            const original = path.resolve(
              prepared.directory,
              prepared.index.originalSource.path,
            );
            prepared.files.push(
              await fileRecord(
                original,
                path.join("original", path.basename(original)),
              ),
            );
            prepared.originalRelative = path.join(
              "original",
              path.basename(original),
            );
          }
          const target = await reserve(root, prepared.name, options.collision);
          if (!target) {
            item.status = "skipped";
            continue;
          }
          item.status = "preparing";
          item.output = target;
          staged.push({ item, prepared, target });
          await prepared.store.snapshotTo(path.join(target, "project.db"));
          job.totalBytes += prepared.files.reduce(
            (sum, file) => sum + file.size,
            0,
          );
        } catch (error) {
          item.status = "failed";
          item.error = error.message;
          if (item.output)
            await rm(item.output, { recursive: true, force: true });
        }
      }
      job.status = job.controller.signal.aborted ? "cancelling" : "running";
      for (const stage of staged) {
        const { item, prepared, target } = stage;
        if (item.status === "failed") continue;
        if (job.controller.signal.aborted) {
          item.status = "cancelled";
          await rm(target, { recursive: true, force: true });
          continue;
        }
        try {
          item.status = "copying";
          const hashes = {};
          for (const file of prepared.files) {
            const hash = await copyFile(
              file,
              path.join(target, file.relative),
              job,
              job.controller.signal,
            );
            hashes[file.relative.replaceAll("\\", "/")] = hash;
          }
          if (
            hashes["pointcloud/metadata.json"].sha256 !==
            digest(prepared.identity.metadataText)
          )
            throw new Error("打包期间源文件发生变化");
          job.controller.signal.throwIfAborted();
          const db = new DatabaseSync(path.join(target, "project.db"));
          try {
            const session = db
              .prepare("SELECT * FROM sessions WHERE dataset_id=?")
              .get(prepared.index.dataset.id);
            const snapshotId =
              session.recovery_snapshot_id || session.saved_snapshot_id;
            if (snapshotId) {
              const value = JSON.parse(
                db
                  .prepare("SELECT payload_json FROM snapshots WHERE id=?")
                  .get(snapshotId).payload_json,
              );
              value.savedAt = new Date().toISOString();
              db.prepare(
                "UPDATE snapshots SET kind='saved',payload_json=? WHERE id=?",
              ).run(JSON.stringify(value), snapshotId);
              db.prepare(
                "UPDATE sessions SET saved_snapshot_id=?,recovery_snapshot_id=NULL WHERE dataset_id=?",
              ).run(snapshotId, prepared.index.dataset.id);
            }
            db.prepare("UPDATE datasets SET source_uri=? WHERE id=?").run(
              "pointcloud",
              prepared.index.dataset.id,
            );
            if (
              db.prepare("PRAGMA integrity_check").get().integrity_check !==
              "ok"
            )
              throw new Error("工程数据库校验失败");
            db.exec(
              "PRAGMA wal_checkpoint(TRUNCATE);PRAGMA journal_mode=DELETE;",
            );
          } finally {
            db.close();
          }
          const sourceIndex = prepared.index;
          const index = {
            ...sourceIndex,
            database: "project.db",
            dataset: {
              ...sourceIndex.dataset,
              source: "pointcloud",
              fingerprint: {
                metadataHash: prepared.identity.metadataText
                  ? digest(prepared.identity.metadataText)
                  : null,
                files: Object.fromEntries(
                  pointFiles
                    .slice(1)
                    .map((name) => [name, hashes["pointcloud/" + name]]),
                ),
              },
            },
            packagedAt: new Date().toISOString(),
          };
          delete index.originalSource;
          if (prepared.originalRelative)
            index.originalSource = {
              path: prepared.originalRelative.replaceAll("\\", "/"),
              included: true,
            };
          await writeFile(
            path.join(target, "package-files.json"),
            JSON.stringify({ version: 1, files: hashes }, null, 2),
          );
          const temporary = path.join(target, entryName + ".tmp");
          await writeFile(temporary, JSON.stringify(index, null, 2));
          await rename(temporary, path.join(target, entryName));
          item.status = "succeeded";
          item.entry = path.join(target, entryName);
          logger?.write("info", "project.package", "Project packaged", {
            path: item.entry,
          });
        } catch (error) {
          item.status = job.controller.signal.aborted ? "cancelled" : "failed";
          item.error = job.controller.signal.aborted
            ? undefined
            : error.message;
          await rm(target, { recursive: true, force: true });
        }
      }
      if (job.controller.signal.aborted) {
        for (const item of job.items)
          if (item.status === "queued") item.status = "cancelled";
        job.status = "cancelled";
      } else
        job.status = job.items.some((item) => item.status === "failed")
          ? "completedWithErrors"
          : "succeeded";
    } catch (error) {
      job.status = "failed";
      job.error = error.message;
      for (const stage of staged)
        if (stage.item.status !== "succeeded")
          await rm(stage.target, { recursive: true, force: true });
    }
  }
  return {
    start(options) {
      if (
        !Array.isArray(options.projects) ||
        !options.projects.length ||
        options.projects.length > 100 ||
        !options.projects.every(
          (file) => typeof file === "string" && path.isAbsolute(file),
        ) ||
        !path.isAbsolute(options.destination || "") ||
        !["rename", "skip"].includes(options.collision || "rename")
      )
        throw new Error("请选择工程和有效的目标目录");
      if (
        [...jobs.values()].some((job) =>
          ["queued", "preparing", "running", "cancelling"].includes(job.status),
        )
      )
        throw new Error("已有打包任务正在运行");
      const job = {
        id: randomUUID(),
        status: "queued",
        completedBytes: 0,
        totalBytes: 0,
        controller: new AbortController(),
        items: [
          ...new Set(options.projects.map((file) => path.resolve(file))),
        ].map((projectPath) => ({ projectPath, status: "queued" })),
      };
      jobs.set(job.id, job);
      setImmediate(() =>
        execute(job, { ...options, collision: options.collision || "rename" }),
      );
      return publicJob(job);
    },
    get(id) {
      const job = jobs.get(id);
      return job ? { ...publicJob(job), error: job.error } : null;
    },
    cancel(id) {
      const job = jobs.get(id);
      if (
        job &&
        ["queued", "preparing", "running", "cancelling"].includes(job.status)
      ) {
        job.status = "cancelling";
        job.controller.abort();
      }
      return job ? publicJob(job) : null;
    },
  };
}
