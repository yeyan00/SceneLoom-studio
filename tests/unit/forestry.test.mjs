import test from "node:test";
import assert from "node:assert/strict";
import {
  forestryState,
  TREE_FIELD,
  validateForestHistory,
  treeColor,
} from "../../shared/forestry.mjs";
import { validateOperation } from "../../shared/edits.mjs";
import { edit, brushPreview, decode } from "../../src/pointcloud/worker.js";
import { historyReducer } from "../../shared/history.mjs";
import { createPluginRegistry } from "../../src/plugins/registry.mjs";
test("plugin registry accepts component contributions, rejects duplicate/reserved IDs and display modes", () => {
  const component = () => null,
    p = {
      id: "forestry",
      label: "Forestry",
      Provider: component,
      Ribbon: component,
      Panel: component,
      displayModes: [{ id: "tree", label: "Trees" }],
    };
  assert.equal(createPluginRegistry([p])[0].id, "forestry");
  assert.throws(() => createPluginRegistry([p, p]));
  assert.throws(() => createPluginRegistry([{ ...p, id: "edit" }]));
  assert.throws(() =>
    createPluginRegistry([
      { ...p, displayModes: [{ id: "rgb", label: "RGB" }] },
    ]),
  );
});
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const selection = {
  kind: "screen",
  matrix,
  polygon: [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ],
};
const tree = (id, extra = {}) => ({
  id: "create" + id,
  type: "createTree",
  payloadVersion: 2,
  treeId: id,
  name: "Tree " + id,
  valueType: "uint16",
  ...extra,
});
const assign = (id, policy = "replace") => ({
  id: crypto.randomUUID(),
  type: "setAttribute",
  payloadVersion: 2,
  fieldId: TREE_FIELD,
  treeId: id,
  value: policy === "remove" ? 0 : id,
  policy,
  selection,
  invert: false,
});
const positions = new Float32Array([0, 0, 0, 0.1, 0.1, 0, 0.8, 0, 0]);
const categories = new Uint8Array([2, 3, 4]);
const forest = { valueType: "uint16", view: "tree", activeTree: 1 };
test("tree creation, conditional assignment and removal are independent of classification and deletion", () => {
  const a = tree(1, { selection, policy: "replace", invert: false }),
    b = tree(2),
    ops = [a, b, assign(2, "unassigned")];
  validateForestHistory(ops, {});
  ops.forEach(validateOperation);
  let result = edit(positions, categories, ops, null, null, null, forest);
  assert.deepEqual([...result.treeIds], [1, 1, 0]);
  assert.deepEqual([...result.effective], [2, 3, 4]);
  result = edit(
    positions,
    categories,
    [...ops, assign(2), assign(1, "remove")],
    null,
    null,
    null,
    forest,
  );
  assert.deepEqual([...result.treeIds], [2, 2, 0]);
  result = edit(
    positions,
    categories,
    [...ops, assign(2), assign(2, "remove")],
    null,
    null,
    null,
    forest,
  );
  assert.deepEqual([...result.treeIds], [0, 0, 0]);
  const deleted = { id: "delete", type: "delete", selection, invert: false };
  result = edit(
    positions,
    categories,
    [a, b, deleted, assign(2)],
    null,
    null,
    null,
    forest,
  );
  assert.deepEqual([...result.treeIds], [1, 1, 0]);
  assert.deepEqual([...result.indices], [2]);
});
test("tree brush incremental values and colors equal cold replay; cancellation leaves baseline intact", () => {
  const creation = tree(1),
    other = tree(2),
    base = edit(
      positions,
      categories,
      [creation, other],
      null,
      null,
      null,
      forest,
    ),
    node = { positions, categories };
  const samples = [
    [300, 250, 20],
    [500, 250, 40],
    [700, 250, 40],
  ];
  let live, op;
  for (let i = 1; i <= samples.length; i++) {
    op = {
      ...assign(1),
      id: "stroke",
      selection: {
        kind: "brush",
        version: 1,
        matrix,
        viewport: [1000, 500],
        samples: samples.slice(0, i),
      },
    };
    live = brushPreview(node, base, op, "base", {}, forest);
  }
  const cold = edit(
    positions,
    categories,
    [creation, other, op],
    null,
    null,
    null,
    forest,
  );
  assert.deepEqual(live.treeIds, cold.treeIds);
  assert.deepEqual(live.colors, cold.colors);
  assert.deepEqual([...base.treeIds], [0, 0, 0]);
  const remove = { ...op, id: "erase", value: 0, policy: "remove" };
  assert.deepEqual(
    brushPreview(node, cold, remove, "next", {}, forest).treeIds,
    edit(
      positions,
      categories,
      [creation, other, op, remove],
      null,
      null,
      null,
      forest,
    ).treeIds,
  );
});
test("tree metadata follows unified history and branch undo, rejects dangling/overflow IDs", () => {
  let state = { operations: [], cursor: 0 };
  const op = tree(1, { selection, invert: false, policy: "replace" });
  state = historyReducer(state, { type: "commit", command: op });
  assert.equal(
    forestryState(state.operations.slice(0, state.cursor)).trees.length,
    1,
  );
  state = historyReducer(state, { type: "undo" });
  assert.equal(
    forestryState(state.operations.slice(0, state.cursor)).trees.length,
    0,
  );
  state = historyReducer(state, { type: "redo" });
  assert.equal(state.operations[0].treeId, 1);
  assert.throws(() => validateForestHistory([assign(1)], {}));
  assert.throws(() => validateOperation(tree(65536)));
  assert.throws(() => validateForestHistory([tree(1), tree(1)], {}));
  assert.equal(treeColor(1), treeColor(1));
  assert.notEqual(treeColor(1), treeColor(2));
});
test("native uint32 treeID preserves IDs above float32 integer precision and default uint16 uses two bytes", () => {
  const metadata = {
    attributes: [
      { name: "position", size: 12 },
      { name: "treeID", type: "uint32", numElements: 1, size: 4 },
    ],
    scale: [1, 1, 1],
  };
  const buffer = new ArrayBuffer(16);
  new DataView(buffer).setUint32(12, 16777217, true);
  assert.equal(decode(buffer, metadata, 1).treeIds[0], 16777217);
  const native = edit(
    new Float32Array([0, 0, 0]),
    new Uint8Array([2]),
    [],
    null,
    null,
    null,
    { valueType: "uint32", sourceTreeIds: new Uint32Array([16777217]) },
  );
  assert.equal(native.treeIds[0], 16777217);
  assert.equal(
    edit(positions, categories, [
      tree(16777217, {
        valueType: "uint32",
        selection,
        invert: false,
        policy: "replace",
      }),
    ]).treeIds[0],
    16777217,
  );
  assert.equal(
    edit(positions, categories, [tree(1)], null, null, null, forest).treeIds
      .byteLength,
    6,
  );
});
