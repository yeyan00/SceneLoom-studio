import test from "node:test";
import assert from "node:assert/strict";
import {
  createAccumulator,
  finishChm,
  parameters,
} from "../../server/chm/algorithm.mjs";
import { validateOperation } from "../../shared/edits.mjs";
import {
  forestryState,
  validateForestHistory,
  pointTreeValue,
} from "../../shared/forestry.mjs";
import { edit } from "../../src/pointcloud/worker.js";

function forest(mode = "classified") {
  const a = createAccumulator(
    { min: [0, 0, 0], max: [20, 10, 30] },
    {
      groundMode: mode,
      resolution: 0.5,
      terrainResolution: 1,
      seedDistance: 4,
      minCrownArea: 2,
    },
  );
  for (let y = 0; y <= 10; y += 0.5)
    for (let x = 0; x <= 20; x += 0.5) {
      const g = 10 + 0.2 * x + 0.1 * y;
      a.add(x, y, g, mode === "classified" ? 2 : 1);
      for (const cx of [5, 15]) {
        const d = Math.hypot(x - cx, y - 5);
        if (d <= 3) a.add(x, y, g + 12 - d * d * 0.8, 5);
      }
    }
  return finishChm(a);
}
const command = (r) => ({
  id: "chm-1",
  payloadVersion: 2,
  type: "segmentTrees",
  valueType: "uint16",
  trees: Array.from({ length: r.treeCount }, (_, i) => ({
    id: i + 1,
    name: "Tree " + (i + 1),
  })),
  grid: r.grid,
  minHeight: 2,
  policy: "unassigned",
  scope: null,
  excludeCategories: [2, 6, 7, 9, 18],
});
test("CHM separates two crowns on sloped terrain with classified and estimated ground", () => {
  for (const mode of ["classified", "estimate"]) {
    const r = forest(mode);
    assert.equal(r.treeCount, 2);
    assert.equal(
      r.stats.groundMethod,
      mode === "classified" ? "classified" : "morphological",
    );
    assert.ok(r.grid.ground[20] > r.grid.ground[0] + 1);
    assert.equal(new Set(r.grid.labels.filter(Boolean)).size, 2);
  }
});
test("CHM rules replay on unloaded points, preserve ground, classification, policies, and deletion order", () => {
  const r = forest(),
    op = command(r);
  validateOperation(op);
  validateForestHistory([op]);
  assert.equal(forestryState([op]).trees.length, 2);
  const left = pointTreeValue(0, op, 5, 5, 23),
    right = pointTreeValue(0, op, 15, 5, 25);
  assert.ok(left && right && left !== right);
  assert.equal(pointTreeValue(0, op, 5, 5, 11.5), 0);
  assert.equal(pointTreeValue(99, op, 5, 5, 23), 99);
  assert.equal(
    pointTreeValue(99, { ...op, policy: "replace" }, 5, 5, 23),
    left,
  );
  const points = new Float32Array([5, 5, 23, 15, 5, 25, 5, 5, 11.5]);
  const first = edit(
    points,
    new Uint8Array([5, 5, 2]),
    [op],
    null,
    null,
    null,
    { view: "tree" },
  );
  assert.deepEqual([...first.treeIds], [left, right, 0]);
  assert.deepEqual([...first.effective], [5, 5, 2]);
  assert.equal(
    edit(points, new Uint8Array([7, 6, 2]), [op], null, null, null, {
      view: "tree",
    }).treeIds[0],
    0,
  );
  const del = {
    id: "delete",
    type: "delete",
    selection: {
      kind: "screen",
      matrix: [0.05, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0.02, 0, 0, 0, 0, 1],
      polygon: [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
    },
    invert: false,
  };
  const classify = { ...del, id: "classify", type: "classify", category: 5 };
  assert.equal(
    edit(points, new Uint8Array([7, 6, 2]), [classify, op], null, null, null, {
      view: "tree",
    }).treeIds[0],
    left,
  );
  assert.equal(
    edit(points, new Uint8Array([7, 6, 2]), [op, classify], null, null, null, {
      view: "tree",
    }).treeIds[0],
    0,
  );
  assert.equal(
    edit(points, new Uint8Array([5, 5, 2]), [del, op], null, null, null, {
      view: "tree",
    }).treeIds[0],
    0,
  );
  const incremental = edit(
    points,
    new Uint8Array([5, 5, 2]),
    [],
    null,
    first,
    null,
    { valueType: "uint16", view: "tree" },
  );
  assert.deepEqual([...incremental.treeIds], [left, right, 0]);
});
test("CHM validates raster bounds, parameters, IDs and field compatibility", () => {
  assert.throws(() => parameters({ resolution: 0 }));
  assert.throws(
    () => createAccumulator({ min: [0, 0], max: [10000, 10000] }, {}),
    /范围过大/,
  );
  assert.throws(() => createAccumulator({min:[0,0],max:[1000,1000]}, {resolution:10,terrainResolution:.5}), /地面网格过密/);
  const op = command(forest());
  assert.throws(() =>
    validateOperation({ ...op, grid: { ...op.grid, labels: [999] } }),
  );
  assert.throws(() => validateForestHistory([op, { ...op, id: "duplicate" }]));
  const bad = structuredClone(op);
  bad.grid.labels[0] = 65535;
  assert.throws(() => validateOperation(bad));
  assert.throws(() =>
    validateForestHistory([op], {
      attributes: [{ name: "treeID", type: "uint32", size: 4, numElements: 1 }],
    }),
  );
});
