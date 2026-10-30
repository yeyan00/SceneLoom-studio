import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePoint,
  insidePolygon,
  validateOperation,
} from "../../shared/edits.mjs";
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const rule = {
  matrix,
  polygon: [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ],
  invert: false,
  type: "classify",
  category: 5,
};
test("selection includes edges and handles a concave polygon", () => {
  assert.equal(insidePolygon(0.5, 0, rule.polygon), true);
  assert.equal(insidePolygon(0.9, 0, rule.polygon), false);
  assert.equal(
    insidePolygon(0.7, 0.7, [
      [0, 0],
      [1, 0],
      [0.5, 0.5],
      [0, 1],
    ]),
    false,
  );
});
test("unloaded points evaluate identically regardless of load order", () => {
  const points = [
    [0, 0, 0],
    [0.8, 0, 0],
    [0.2, 0.2, 0],
  ];
  const forward = points.map((p) => evaluatePoint(...p, 2, [rule]));
  const reverse = points
    .toReversed()
    .map((p) => evaluatePoint(...p, 2, [rule]))
    .toReversed();
  assert.deepEqual(forward, reverse);
  assert.deepEqual(
    forward.map((p) => p.category),
    [5, 2, 5],
  );
});
test("delete, history cursor and redo preserve source category", () => {
  const deletion = { ...rule, type: "delete" };
  assert.equal(evaluatePoint(0, 0, 0, 2, [rule, deletion]).deleted, true);
  assert.deepEqual(evaluatePoint(0, 0, 0, 2, [rule]), {
    category: 5,
    deleted: false,
  });
  assert.deepEqual(evaluatePoint(0, 0, 0, 2, []), {
    category: 2,
    deleted: false,
  });
});
test("inverse is the complement in the dataset including offscreen points", () => {
  assert.equal(
    evaluatePoint(0.8, 0, 0, 2, [{ ...rule, invert: true }]).category,
    5,
  );
  assert.equal(
    evaluatePoint(0, 0, 0, 2, [{ ...rule, invert: true }]).category,
    2,
  );
});
test("depth clip and frozen matrix determine selection", () => {
  assert.equal(evaluatePoint(0, 0, 3, 2, [rule]).category, 2);
  const moved = { ...rule, matrix: [...matrix] };
  moved.matrix[12] = 2;
  assert.equal(evaluatePoint(0, 0, 0, 2, [moved]).category, 2);
});
test("reject malformed persisted rules", () => {
  assert.throws(() => validateOperation({ ...rule, matrix: [NaN] }));
  assert.throws(() => validateOperation({ ...rule, category: 256 }));
  validateOperation(rule);
});
