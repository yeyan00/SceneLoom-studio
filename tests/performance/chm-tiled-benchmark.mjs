import { fork } from "node:child_process";
import { Worker } from "node:worker_threads";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { treeColor } from "../../shared/forestry.mjs";

// Each case runs in a fresh process: RSS includes Node and output serialization,
// rather than confusing the JS heap with total algorithm memory.
const [folder, ...args] = process.argv.slice(2);
if (!folder)
  throw Error(
    "Usage: node tests/performance/chm-tiled-benchmark.mjs <Potree folder>",
  );
if (args[0] === "--case") {
  const tileSize = Number(args[1]),
    metadata = JSON.parse(
      await readFile(path.join(folder, "metadata.json"), "utf8"),
    );
  const start = performance.now(),
    baseline = process.memoryUsage().rss;
  let peak = baseline;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 5);
  try {
    const r = await new Promise((resolve, reject) => {
      const w = new Worker(
        new URL("../../server/chm/worker.mjs", import.meta.url),
        {
          workerData: {
            folder,
            metadata,
            operations: [],
            scope: null,
            parameters: { tileSize },
          },
        },
      );
      w.on("error", reject);
      w.on("message", (m) => {
        if (m.type === "error") reject(Error(m.error));
        if (m.type === "result") resolve(m.result);
      });
    });
    peak = Math.max(
      peak,
      process.memoryUsage().rss,
      process.resourceUsage().maxRSS * 1024,
    );
    const result = {
      tileSize,
      treeCount: r.treeCount,
      stats: r.stats,
      wallMs: performance.now() - start,
      baselineRssBytes: baseline,
      peakProcessRssBytes: peak,
      rssIncreaseBytes: peak - baseline,
    };
    if (args[2]) {
      await writeFile(
        path.join(args[2], tileSize + "-grid.json"),
        JSON.stringify(r.grid),
      );
      const png = new PNG({ width: r.grid.width, height: r.grid.height }),
        colors = new Map();
      for (let i = 0; i < r.grid.labels.length; i++) {
        const id = r.grid.labels[i];
        if (!colors.has(id)) {
          const hex = treeColor(id);
          colors.set(
            id,
            [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)),
          );
        }
        const at =
          ((r.grid.height - 1 - Math.floor(i / r.grid.width)) * r.grid.width +
            (i % r.grid.width)) *
          4;
        png.data.set([...colors.get(id), 255], at);
      }
      await writeFile(
        path.join(args[2], tileSize + "-instances.png"),
        PNG.sync.write(png),
      );
    }
    process.send?.(result);
  } finally {
    clearInterval(timer);
  }
} else {
  const dir = path.resolve(
    "test-results",
    new Date().toISOString().replace(/[:.]/g, "-") + "-chm-tiled",
  );
  await mkdir(dir, { recursive: true });
  const reports = [];
  for (const size of [256, 64, 32]) {
    const result = await new Promise((resolve, reject) => {
      const p = fork(
        fileURLToPath(import.meta.url),
        [path.resolve(folder), "--case", String(size), dir],
        { stdio: ["ignore", "inherit", "inherit", "ipc"], windowsHide: true },
      );
      let result;
      p.on("message", (v) => (result = v));
      p.on("error", reject);
      p.on("exit", (code) =>
        code || !result
          ? reject(Error("Benchmark process failed: " + code))
          : resolve(result),
      );
    });
    reports.push(result);
    console.log(result);
  }
  const baseline = JSON.parse(
    await readFile(path.join(dir, "256-grid.json"), "utf8"),
  );
  for (const r of reports) {
    const grid = JSON.parse(
      await readFile(path.join(dir, r.tileSize + "-grid.json"), "utf8"),
    );
    const pairs = new Map();
    let foreground = 0;
    for (let i = 0; i < grid.labels.length; i++) {
      const a = baseline.labels[i],
        b = grid.labels[i];
      if (!a && !b) continue;
      foreground++;
      if (a && b) {
        if (!pairs.has(b)) pairs.set(b, new Map());
        const row = pairs.get(b);
        row.set(a, (row.get(a) || 0) + 1);
      }
    }
    let agreement = 0;
    for (const row of pairs.values()) agreement += Math.max(...row.values());
    r.foregroundBestMatchAgreement = foreground ? agreement / foreground : 1;
  }
  await writeFile(
    path.join(dir, "report.json"),
    JSON.stringify(
      {
        folder: path.resolve(folder),
        reports,
        note: "Fresh-process RSS includes Node/Worker and result copies. OS file cache is uncontrolled. All Potree points read once; pointsWithOverlap counts raster samples reused by tile halos, not disk reads. Foreground agreement is a many-to-one raster consistency measure against the single-tile case, not segmentation accuracy.",
      },
      null,
      2,
    ),
  );
  console.log("Report:", dir);
}
