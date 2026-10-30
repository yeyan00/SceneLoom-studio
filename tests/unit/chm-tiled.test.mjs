import test from "node:test";
import assert from "node:assert/strict";
import {
  segmentTiled,
  planChmTiles,
  matchOverlap,
  sliceAccumulator,
} from "../../server/chm/tiled.mjs";
import { createAccumulator, finishChm } from "../../server/chm/algorithm.mjs";
import { validateOperation } from "../../shared/edits.mjs";
import { pointTreeValue } from "../../shared/forestry.mjs";
const bounds = { min: [0, 0, 0], max: [64, 32, 30] };
function forest() {
  const points = [];
  for (let y = 0; y <= 32; y += 0.5)
    for (let x = 0; x <= 64; x += 0.5) {
      const g = 5 + 0.03 * x + 0.02 * y;
      points.push([x, y, g, 2]);
      for (const [cx, cy] of [
        [16, 16],
        [32, 16],
        [48, 16],
      ]) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= 5) points.push([x, y, g + 14 - 0.3 * d * d, 5]);
      }
    }
  return points;
}
const p = {
  resolution: 0.5,
  terrainResolution: 1,
  groundMode: "classified",
  groundWindow: 2,
  seedDistance: 4,
  minCrownArea: 2,
  tileSize: 16,
  overlap: 6,
};
async function run(points, params = p) {
  return segmentTiled(bounds, params, async (tile, acc) => {
    for (const point of points) acc.add(...point);
    return { scannedPoints: points.length };
  });
}
test("overlap fusion joins crowns crossing tile edges and four-way corners without joining neighbors", async () => {
  const points = forest(),
    r = await run(points);
  assert.equal(r.treeCount, 3);
  assert.ok(r.stats.tileCount > 1);
  assert.ok(r.stats.mergedInstances > 0);
  const op = {
    id: "tiled",
    type: "segmentTrees",
    payloadVersion: 2,
    valueType: "uint16",
    trees: [1, 2, 3].map((id) => ({ id, name: "Tree " + id })),
    grid: r.grid,
    minHeight: 2,
    policy: "replace",
    scope: null,
    excludeCategories: [2],
  };
  validateOperation(op);
  for (const cx of [16, 32, 48]) {
    const ids = [-1, -0.1, 0, 0.1, 1].map((dx) =>
      pointTreeValue(0, op, cx + dx, 16, 20, null, 5),
    );
    assert.ok(ids[0]);
    assert.equal(new Set(ids).size, 1);
  }
  assert.equal(
    new Set([16, 32, 48].map((x) => pointTreeValue(0, op, x, 16, 20, null, 5)))
      .size,
    3,
  );
  const a = createAccumulator(bounds, p);
  points.forEach((v) => a.add(...v));
  assert.equal(finishChm(a).treeCount, r.treeCount);
  const repeat = await run(points);
  assert.deepEqual(repeat.grid, r.grid);
});
test("tile cores own every cell once; halos expand for terrain and workspaces remain capped", () => {
  const plan = planChmTiles(bounds, p),
    owners = new Uint8Array(plan.width * plan.height);
  for (const t of plan.tiles)
    for (let y = t.y; y < t.endY; y++)
      for (let x = t.x; x < t.endX; x++) owners[y * plan.width + x]++;
  assert.ok(owners.every((v) => v === 1));
  assert.ok(plan.halo * p.resolution >= 6);
  assert.throws(
    () => planChmTiles({ min: [0, 0, 0], max: [5000, 5000, 30] }, p),
    /结果栅格过大/,
  );
});
test("empty tiles do not invent instances; completely empty input is rejected", async () => {
  await assert.rejects(run([]), /没有有效点/);
  const r = await run(forest().filter((v) => v[0] < 22));
  assert.equal(r.treeCount, 1);
});
test("overlap matching requires crown agreement and nearby peaks, not mere touching", () => {
  const tile = { sx: 0, sy: 0, ex: 4, ey: 4 };
  const a = {
    tile,
    width: 4,
    labels: new Uint32Array(16).fill(1),
    peaks: new Map([[1, { x: 0, y: 0 }]]),
    ids: [0, 1],
  };
  const b = { ...a, peaks: new Map([[1, { x: 10, y: 0 }]]), ids: [0, 2] };
  assert.deepEqual(matchOverlap(a, b, 0.5, 3), []);
  b.peaks = new Map([[1, { x: 0.1, y: 0.1 }]]);
  assert.deepEqual(matchOverlap(a, b, 0.5, 3), [[1, 2]]);
});

test("single streamed raster slicing matches point-driven tiles and preserves source arrays", async () => {
  const points = forest(),
    source = createAccumulator(bounds, p);
  points.forEach((v) => source.add(...v));
  const top = source.top.slice();
  const sliced = await segmentTiled(bounds, p, async (tile, acc) => ({
    accumulator: sliceAccumulator(source, tile, acc),
  }));
  const direct = await run(points);
  assert.deepEqual(sliced.grid, direct.grid);
  assert.deepEqual(source.top, top);
  assert.equal(source.stats.points, points.length);
});

test("terrain sampling keeps the global grid phase with non-integral resolution ratios", () => {
  const q = { ...p, resolution: 0.3, terrainResolution: 0.7 },
    source = createAccumulator(bounds, q);
  forest().forEach((v) => source.add(...v));
  for (const tile of planChmTiles(bounds, q).tiles) {
    const acc = sliceAccumulator(source, tile);
    const sx = Math.floor((tile.sx * q.resolution) / q.terrainResolution),
      sy = Math.floor((tile.sy * q.resolution) / q.terrainResolution);
    assert.ok(
      Math.abs(
        acc.terrainOffset[0] +
          sx * q.terrainResolution -
          tile.sx * q.resolution,
      ) < 1e-9,
    );
    for (let y = 0; y < acc.th; y++)
      for (let x = 0; x < acc.tw; x++)
        assert.equal(
          acc.low[y * acc.tw + x],
          source.low[(y + sy) * source.tw + x + sx],
        );
  }
});
