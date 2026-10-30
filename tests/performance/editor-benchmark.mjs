import { Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { openProject, closeProjects } from "../../server/project-store.mjs";
const workerUrl = new URL("../../src/pointcloud/worker.js", import.meta.url)
  .href;
const worker = new Worker(
  `const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};import(${JSON.stringify(workerUrl)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});});`,
  { eval: true },
);
await new Promise((resolve, reject) => {
  worker.once("message", resolve);
  worker.once("error", reject);
});
let id = 0;
const pending = new Map();
worker.on("message", (data) => {
  const task = pending.get(data.id);
  if (task) {
    pending.delete(data.id);
    data.error ? task.reject(new Error(data.error)) : task.resolve(data.result);
  }
});
const run = (type, value, transfer = []) =>
  new Promise((resolve, reject) => {
    const key = ++id;
    pending.set(key, { resolve, reject });
    worker.postMessage({ id: key, type, ...value }, transfer);
  });
const count = 50000,
  nodes = 4,
  metadata = {
    scale: [0.0001, 0.0001, 0.0001],
    attributes: [
      { name: "position", size: 12 },
      { name: "classification", size: 1 },
    ],
  };
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const commands = Array.from({ length: 80 }, (_, i) => ({
  id: "benchmark-" + i,
  type: "classify",
  category: 2 + (i % 6),
  invert: false,
  selection: {
    kind: "screen",
    matrix,
    polygon: [
      [-1 + (i % 10) * 0.1, -1],
      [0.2 + (i % 10) * 0.08, -1],
      [0.2 + (i % 10) * 0.08, 1],
      [-1 + (i % 10) * 0.1, 1],
    ],
  },
}));
const samples = {};
const temp = await mkdtemp(path.join(os.tmpdir(), "sceneloom-perf-"));
async function measure(name, fn) {
  const start = performance.now();
  const value = await fn();
  samples[name] = Number((performance.now() - start).toFixed(2));
  return value;
}
const hash = (result) =>
  createHash("sha256")
    .update(Buffer.from(result.colors.buffer))
    .update(Buffer.from(result.indices.buffer))
    .digest("hex");
try {
  await measure("decodeMs", async () => {
    for (let n = 0; n < nodes; n++) {
      const buffer = new ArrayBuffer(count * 13),
        view = new DataView(buffer);
      for (let i = 0; i < count; i++) {
        view.setInt32(i * 13, (i % 10000) - 5000, true);
        view.setInt32(i * 13 + 4, ((i * 7) % 10000) - 5000, true);
        view.setInt32(i * 13 + 8, ((i * 3) % 10000) - 5000, true);
        view.setUint8(i * 13 + 12, 2);
      }
      await run("decode", { key: String(n), buffer, metadata, count }, [
        buffer,
      ]);
    }
  });
  await measure("cold80CommandsMs", () =>
    Promise.all(
      Array.from({ length: nodes }, (_, n) =>
        run("update", { key: String(n), operations: commands, preview: null }),
      ),
    ),
  );
  const extra = { ...commands[0], id: "appended", category: 8 };
  const incremental = await measure("appendOneCommandMs", () =>
    Promise.all(
      Array.from({ length: nodes }, (_, n) =>
        run("update", {
          key: String(n),
          operations: [...commands, extra],
          preview: null,
        }),
      ),
    ),
  );
  await measure("undoTo80CommandsMs", () =>
    Promise.all(
      Array.from({ length: nodes }, (_, n) =>
        run("update", { key: String(n), operations: commands, preview: null }),
      ),
    ),
  );
  const redone = await measure("redoOneCommandMs", () =>
    Promise.all(
      Array.from({ length: nodes }, (_, n) =>
        run("update", {
          key: String(n),
          operations: [...commands, extra],
          preview: null,
        }),
      ),
    ),
  );
  assert.deepEqual(incremental.map(hash), redone.map(hash));
  const store = await openProject({
    stateDir: temp,
    id: "benchmark",
    folder: temp,
    revision: "fixture",
    metadata: { points: count * nodes },
  });
  const history = Array.from({ length: 1000 }, (_, i) => ({
    ...commands[i % 80],
    id: "saved-" + i,
  }));
  await measure("sqliteSave1000CommandsMs", () =>
    store.save(
      {
        operations: history,
        cursor: history.length,
        sourceRevision: "fixture",
        workspace: { region: null },
      },
      true,
    ),
  );
  assert.equal(store.load().saved.cursor, 1000);
  const report = {
    date: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      totalMemoryGB: Number((os.totalmem() / 2 ** 30).toFixed(1)),
    },
    scenario: {
      loadedPoints: count * nodes,
      nodes,
      historyCommands: 80,
      savedHistoryCommands: 1000,
      workerCount: 1,
    },
    measurements: samples,
    rssMB: Number((process.memoryUsage().rss / 2 ** 20).toFixed(1)),
    correctness: "incremental result matches redo; saved history reloaded",
    limitations:
      "Single worker microbenchmark; no GPU rendering or full-dataset scan. Browser timings are measured by test:workspace.",
  };
  const folder = path.resolve("test-results", "performance");
  await mkdir(folder, { recursive: true });
  const output = path.join(
    folder,
    new Date().toISOString().replace(/[:.]/g, "-") + ".json",
  );
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report: output }, null, 2));
} finally {
  closeProjects();
  await worker.terminate();
  await rm(temp, { recursive: true, force: true });
}
