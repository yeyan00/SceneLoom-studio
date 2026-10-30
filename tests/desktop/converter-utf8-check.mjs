import { spawn, spawnSync } from "node:child_process";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLasFixture } from "../fixtures/generate.mjs";
import { scanPotree } from "../../server/chm/potree-reader.mjs";
import { Worker } from "node:worker_threads";

if (process.platform !== "win32") throw Error("Windows diagnostic only");
const root = path.resolve(
  "test-results",
  new Date().toISOString().replace(/[:.]/g, "-") + "-converter-utf8",
);
await mkdir(root, { recursive: true });
const bundled = path.resolve("tools/PotreeConverter_2.1.5_x64_windows");
const powershell = path.join(
  process.env.SystemRoot,
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);
const patched = path.join(root, "patched-tool");
await mkdir(patched);
for (const name of ["PotreeConverter.exe", "laszip.dll"])
  await copyFile(path.join(bundled, name), path.join(patched, name));
const patch = spawnSync(
  powershell,
  [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.resolve("tests/helpers/pe-utf8-manifest.ps1"),
    "-Executable",
    path.join(patched, "PotreeConverter.exe"),
  ],
  { encoding: "utf8", windowsHide: true },
);
if (patch.status !== 0) throw Error(patch.stderr || patch.stdout);
await writeFile(path.join(root, "manifest.json"), patch.stdout);
const english = await createLasFixture(path.join(root, "input", "sample.las"));
const chinese = path.join(root, "input", "林业 样本.las");
await copyFile(english, chinese);
const chineseTool = path.join(root, "中文 程序");
await mkdir(chineseTool);
for (const name of ["PotreeConverter.exe", "laszip.dll"])
  await copyFile(path.join(patched, name), path.join(chineseTool, name));
const cases = [
  { name: "baseline-ascii", tool: bundled },
  { name: "baseline-chinese-input", tool: bundled, input: chinese },
  { name: "utf8-ascii", tool: patched },
  { name: "utf8-chinese-input", tool: patched, input: chinese },
  { name: "utf8-chinese-output", tool: patched, output: "中文 输出" },
  { name: "utf8-chinese-chunks", tool: patched, chunks: "中文 临时" },
  { name: "utf8-chinese-executable", tool: chineseTool },
  {
    name: "utf8-all-chinese",
    tool: chineseTool,
    input: chinese,
    output: "中文 输出",
    chunks: "中文 临时",
  },
];
const results = [];
for (const c of cases) {
  const work = path.join(root, c.name);
  await mkdir(work);
  const output = path.join(work, c.output || "output"),
    chunks = path.join(work, c.chunks || "chunks");
  const start = performance.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      path.join(c.tool, "PotreeConverter.exe"),
      [
        c.input || english,
        "-o",
        output,
        "--chunkdir",
        chunks,
        "--encoding",
        "UNCOMPRESSED",
      ],
      { cwd: c.tool, windowsHide: true },
    );
    let log = "",
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 120000);
    child.stdout.on("data", (b) => (log += b));
    child.stderr.on("data", (b) => (log += b));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        hex: code === null ? null : (code >>> 0).toString(16),
        signal,
        timedOut,
        log,
      });
    });
  });
  await writeFile(path.join(work, "converter.log"), result.log);
  let points = null,
    scannedPoints = null,
    error = null;
  try {
    if (result.code !== 0) throw Error(`Converter exit ${result.hex}`);
    const metadata = JSON.parse(
      await readFile(path.join(output, "metadata.json"), "utf8"),
    );
    points = metadata.points;
    const scan = await scanPotree(output, metadata, () => {});
    scannedPoints = scan.scannedPoints;
    if (points !== 50000 || scannedPoints !== 50000)
      throw Error("Point count mismatch");
  } catch (e) {
    error = e.message;
  }
  const { log, ...status } = result;
  const r = {
    name: c.name,
    ...status,
    passed: !error,
    points,
    scannedPoints,
    error,
    elapsedMs: performance.now() - start,
    pathsFound: /#paths:\s*(\d+)/.exec(log)?.[1],
  };
  results.push(r);
  console.log(r);
}
const report = {
  platform: process.platform,
  os: (await import("node:os")).release(),
  root,
  manifest: JSON.parse(patch.stdout),
  results,
};
if (process.argv.includes("--real")) {
  if (!process.env.SCENELOOM_REAL_LAS_NAMES)
    throw new Error('Set SCENELOOM_REAL_LAS_NAMES to a JSON array of local LAS filenames for --real.');
  report.realLas = [];
  for (const name of JSON.parse(process.env.SCENELOOM_REAL_LAS_NAMES || '[]')) {
    const folder = path.join(root, "真实数据", name.slice(0, -4));
    await mkdir(folder, { recursive: true });
    const input = path.resolve("data/linye", name),
      output = path.join(folder, "点云 输出");
    const before = await (
      await import("node:crypto")
    )
      .createHash("sha256")
      .update(await readFile(input))
      .digest("hex");
    let log = "";
    const start = performance.now();
    const code = await new Promise((resolve, reject) => {
      const p = spawn(
        path.join(chineseTool, "PotreeConverter.exe"),
        [
          input,
          "-o",
          output,
          "--chunkdir",
          path.join(folder, "临时 分块"),
          "--encoding",
          "UNCOMPRESSED",
        ],
        { cwd: chineseTool, windowsHide: true },
      );
      p.stdout.on("data", (b) => (log += b));
      p.stderr.on("data", (b) => (log += b));
      p.on("error", reject);
      p.on("close", resolve);
    });
    await writeFile(path.join(folder, "converter.log"), log);
    const r = { name, code, conversionMs: performance.now() - start };
    if (code === 0) {
      const metadata = JSON.parse(
        await readFile(path.join(output, "metadata.json"), "utf8"),
      );
      const classes = {};
      r.points = metadata.points;
      r.scan = await scanPotree(output, metadata, (x, y, z, c) => {
        classes[c] = (classes[c] || 0) + 1;
      });
      r.classes = classes;
      r.chm = await new Promise((resolve, reject) => {
        const w = new Worker(
          new URL("../../server/chm/worker.mjs", import.meta.url),
          {
            workerData: {
              folder: output,
              metadata,
              operations: [],
              scope: null,
              parameters: {},
            },
          },
        );
        w.on("error", reject);
        w.on("message", (m) => {
          if (m.type === "error") reject(Error(m.error));
          if (m.type === "result")
            resolve({
              treeCount: m.result.treeCount,
              stats: m.result.stats,
              warnings: m.result.warnings,
            });
        });
      });
    }
    const after = (await import("node:crypto"))
      .createHash("sha256")
      .update(await readFile(input))
      .digest("hex");
    r.sourceUnchanged = before === after;
    report.realLas.push(r);
    console.log(r);
  }
}
await writeFile(
  path.join(root, "report.json"),
  JSON.stringify(report, null, 2),
);
console.log("Report:", path.join(root, "report.json"));
