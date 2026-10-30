import { parentPort, workerData } from "node:worker_threads";
import { segmentTiled, planChmTiles, sliceAccumulator } from "./tiled.mjs";
import { createAccumulator } from "./algorithm.mjs";
import { scanPotree } from "./potree-reader.mjs";
import { evaluatePoint } from "../../shared/edits.mjs";
import { inRegion, regionBounds } from "../../shared/selection.mjs";

try {
  const { folder, metadata, operations, scope, parameters } = workerData;
  const position = metadata.attributes.find((a) => a.name === "position");
  const bounds = {
    min: position.min.map((v, i) => v - metadata.offset[i]),
    max: position.max.map((v, i) => v - metadata.offset[i]),
  };
  if (scope) {
    const b = regionBounds(scope);
    for (let i = 0; i < 3; i++) {
      bounds.min[i] = Math.max(bounds.min[i], b.min[i]);
      bounds.max[i] = Math.min(bounds.max[i], b.max[i]);
    }
  }
  if (bounds.min.some((v, i) => v > bounds.max[i]))
    throw new Error("局部区域不与点云相交");
  const edits = operations.filter(
    (op) => op.type === "classify" || op.type === "delete",
  );
  const start = performance.now();
  planChmTiles(bounds, parameters); // Validate before reading or allocating.
  const source = createAccumulator(bounds, parameters);
  let lastProgress = 0;
  const scan = await scanPotree(
    folder,
    metadata,
    (x, y, z, category) => {
      if (!inRegion(x, y, z, scope)) return;
      const effective = edits.length
        ? evaluatePoint(x, y, z, category, edits)
        : { category, deleted: false };
      if (!effective.deleted) source.add(x, y, z, effective.category);
    },
    (progress) => {
      const now = performance.now();
      if (now - lastProgress > 200) {
        lastProgress = now;
        parentPort.postMessage({
          type: "progress",
          phase: "scan",
          ...progress,
        });
      }
    },
    scope,
  );
  const result = await segmentTiled(
    bounds,
    parameters,
    async (tile, acc) => ({ accumulator: sliceAccumulator(source, tile, acc) }),
    (progress) => parentPort.postMessage({ type: "progress", ...progress }),
  );
  result.stats = {
    ...result.stats,
    ...scan,
    points: source.stats.points,
    groundPoints: source.stats.groundPoints,
    sourceRasterBytes:
      source.top.byteLength +
      source.low.byteLength +
      source.ground.byteLength +
      source.pointCounts.byteLength +
      source.groundCounts.byteLength,
    elapsedMs: performance.now() - start,
    peakRssBytes: Math.max(
      result.stats.peakRssBytes,
      process.memoryUsage().rss,
    ),
  };
  parentPort.postMessage({ type: "result", result });
} catch (error) {
  parentPort.postMessage({ type: "error", error: error.message });
}
