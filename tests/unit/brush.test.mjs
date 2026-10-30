import test from "node:test";
import assert from "node:assert/strict";
import { matchesBrush, validateBrush } from "../../shared/brush.mjs";
import { edit, brushPreview } from "../../src/pointcloud/worker.js";
import { validateOperation } from "../../shared/edits.mjs";
import { PointCloudRuntime } from "../../src/pointcloud/runtime.js";
import * as THREE from "three";
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const brush = (samples) => ({
  kind: "brush",
  version: 1,
  matrix,
  viewport: [1000, 500],
  samples,
});
const op = (selection) => ({
  id: "stroke",
  type: "classify",
  category: 5,
  invert: false,
  selection,
});
test("brush swept coverage is circular in pixels, continuous, depth bounded and version validated", () => {
  const selection = brush([
    [300, 250, 20],
    [700, 250, 20],
  ]);
  validateOperation(op(selection));
  assert.ok(matchesBrush(0, 0, 0, selection));
  assert.ok(matchesBrush(0, 0, -0.9, selection));
  assert.ok(matchesBrush(0, 0, 0.9, selection));
  assert.ok(matchesBrush(0, 0.08, 0, selection));
  assert.ok(!matchesBrush(0, 0.081, 0, selection));
  assert.ok(!matchesBrush(0, 0, 1.1, selection));
  assert.ok(!matchesBrush(-0.5, 0, 0, selection));
  assert.ok(matchesBrush(0, 0.08, 0, brush([[500, 250, 20]])));
  assert.throws(() => validateBrush({ ...selection, version: 2 }));
  assert.throws(() => validateBrush(brush([[0, 0, NaN]])));
});
test("variable radius sweep matches independent dense disk sampling", () => {
  const a = [200, 150, 8],
    b = [750, 330, 90],
    selection = brush([a, b]);
  for (let x = 100; x < 900; x += 23)
    for (let y = 30; y < 470; y += 19) {
      let min = Infinity;
      for (let i = 0; i <= 2000; i++) {
        const t = i / 2000,
          r = a[2] + (b[2] - a[2]) * t;
        min = Math.min(
          min,
          Math.hypot(
            x - a[0] - (b[0] - a[0]) * t,
            y - a[1] - (b[1] - a[1]) * t,
          ) - r,
        );
      }
      if (Math.abs(min) < 0.01) continue;
      assert.equal(
        matchesBrush(x / 500 - 1, 1 - y / 250, 0, selection),
        min <= 0,
      );
    }
});
test("incremental live brush matches cold replay, scope and deletion remain correct", () => {
  const positions = new Float32Array(
    Array.from({ length: 2400 }, (_, i) =>
      i % 3 === 0 ? Math.sin(i) * 0.9 : i % 3 === 1 ? Math.cos(i) * 0.8 : 0,
    ),
  );
  const categories = new Uint8Array(800).fill(2),
    node = { positions, categories };
  const previous = {
    ...op(brush([[200, 250, 40]])),
    id: "old",
    type: "delete",
  };
  const base = edit(positions, categories, [previous]);
  const samples = [
    [200, 250, 12],
    [450, 250, 24],
    [800, 310, 60],
  ];
  let live;
  for (let i = 1; i <= samples.length; i++)
    live = brushPreview(node, base, op(brush(samples.slice(0, i))), "old", {});
  const cold = edit(positions, categories, [previous, op(brush(samples))]);
  assert.deepEqual(live.effective, cold.effective);
  assert.deepEqual(live.deleted, cold.deleted);
  assert.deepEqual(live.colors, cold.colors);
  const undone = edit(positions, categories, [previous]);
  assert.deepEqual(undone.effective, base.effective);
  const changed = {
    ...op(brush([[500, 250, 100]])),
    id: "another",
    category: 7,
    scope: { center: [0, 0, 0], half: [0.1, 0.1, 0.1], angle: 0 },
  };
  assert.deepEqual(
    brushPreview(node, base, changed, "old", {}).effective,
    edit(positions, categories, [previous, changed]).effective,
  );
});
test("brush node pruning is conservative across multiple nodes and perspective crossings", () => {
  const runtime = Object.create(PointCloudRuntime.prototype),
    operation = op(
      brush([
        [300, 250, 40],
        [700, 250, 80],
      ]),
    );
  for (let i = 0; i < 80; i++) {
    const p = new THREE.Vector3(Math.sin(i) * 0.9, Math.cos(i) * 0.8, 0),
      node = {
        box: new THREE.Box3(
          p.clone().addScalar(-0.02),
          p.clone().addScalar(0.02),
        ),
      };
    if (matchesBrush(p.x, p.y, p.z, operation.selection))
      assert.ok(runtime.mayAffect(node, operation));
  }
  const crossing = {
    ...operation,
    selection: { ...operation.selection, matrix: [...matrix] },
  };
  crossing.selection.matrix[15] = 0;
  assert.ok(
    runtime.mayAffect(
      {
        box: new THREE.Box3(
          new THREE.Vector3(-1, -1, -1),
          new THREE.Vector3(1, 1, 1),
        ),
      },
      crossing,
    ),
  );
});
