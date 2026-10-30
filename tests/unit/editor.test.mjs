import test from "node:test";
import assert from "node:assert/strict";
import {
  combineSelection,
  regionFromLine,
  inRegion,
  validateSelection,
} from "../../shared/selection.mjs";
import {
  evaluatePoint,
  selected,
  validateOperation,
} from "../../shared/edits.mjs";
import { historyReducer, editSignature } from "../../shared/history.mjs";
import { edit } from "../../src/pointcloud/worker.js";
import { PointCloudRuntime } from "../../src/pointcloud/runtime.js";
import * as THREE from "three";
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const box = (min, max) => ({
  kind: "screen",
  matrix: [...matrix],
  polygon: [
    [min, -1],
    [max, -1],
    [max, 1],
    [min, 1],
  ],
});
const command = (
  id,
  selection,
  type = "classify",
  category = 5,
  scope = null,
) => ({ id, selection, type, category, scope, invert: false });
test("selection set algebra, local inverse and depth include unloaded points consistently", () => {
  const a = box(-1, 0.3),
    b = box(-0.3, 1),
    union = combineSelection(a, b, "union"),
    intersection = combineSelection(a, b, "intersection"),
    difference = combineSelection(a, b, "difference");
  assert.equal(selected(0.8, 0, 0, command("u", union)), true);
  assert.equal(selected(0.8, 0, 0, command("i", intersection)), false);
  assert.equal(selected(-0.8, 0, 0, command("d", difference)), true);
  assert.equal(selected(0, 0, 0, command("d", difference)), false);
  const scope = { center: [0, 0, 0], half: [0.5, 0.5, 0.5], angle: 0 };
  assert.equal(
    selected(0.4, 0, 0, {
      ...command("r", box(-0.1, 0.1), "classify", 5, scope),
      invert: true,
    }),
    true,
  );
  assert.equal(
    selected(0.8, 0, 0, {
      ...command("r", a, "classify", 5, scope),
      invert: true,
    }),
    false,
  );
  assert.equal(
    selected(0, 0, 0.8, command("z", { ...a, depth: [-0.2, 0.2] })),
    false,
  );
  validateOperation(command("valid", union));
  const slab=command('slab',{...box(-.1,.1),depth:[-.2,.2]});
  assert.equal(selected(.8,0,.8,{...slab,invert:true}),false);
  assert.equal(selected(.8,0,0,{...slab,invert:true}),true);
  assert.throws(() => validateSelection({ ...a, matrix: [NaN] }));
  let deep = a;
  for (let i = 0; i < 25; i++) deep = { kind: "union", children: [deep, a] };
  assert.throws(() => validateSelection(deep));
});
test("rotated centerline region has stable local axes and rejects degeneracy", () => {
  const region = regionFromLine([0, 0, 0], [10, 10, 0], 2, -5, 5);
  assert.equal(inRegion(5, 5, 0, region), true);
  assert.equal(inRegion(5, 8, 0, region), false);
  assert.equal(inRegion(5, 5, 6, region), false);
  assert.throws(() => regionFromLine([0, 0], [0, 0], 2, 0, 1));
});
test("history freezes commands, branches redo and returns to the saved semantic state", () => {
  let state = { operations: [], cursor: 0 };
  const first = command("a", box(-1, 1));
  state = historyReducer(state, { type: "commit", command: first });
  first.selection.matrix[0] = 9;
  const signature = editSignature({
    ...state,
    classes: [],
    workspace: { region: null },
  });
  assert.equal(state.operations[0].selection.matrix[0], 1);
  state = historyReducer(state, {
    type: "commit",
    command: command("b", box(-1, 1), "delete"),
  });
  assert.equal(evaluatePoint(0, 0, 0, 2, state.operations).deleted, true);
  state = historyReducer(state, { type: "undo" });
  assert.equal(
    editSignature({
      ...state,
      classes: [],
      workspace: { region: null, cameras: {} },
    }),
    signature,
  );
  assert.deepEqual(
    evaluatePoint(0, 0, 0, 2, state.operations.slice(0, state.cursor)),
    { category: 5, deleted: false },
  );
  state = historyReducer(state, {
    type: "commit",
    command: command("c", box(-1, 1), "classify", 7),
  });
  state = historyReducer(state, { type: "redo" });
  assert.deepEqual(
    state.operations.map((op) => op.id),
    ["a", "c"],
  );
  assert.equal(state.cursor, 2);
});
test("incremental loaded-node edit matches cold evaluation, including deletion and preview", () => {
  const positions = new Float32Array([0, 0, 0, 0.8, 0, 0]),
    categories = new Uint8Array([2, 3]);
  const first = command("a", box(-0.4, 0.4)),
    second = command("b", box(-1, 1), "delete");
  const base = edit(positions, categories, [first]);
  const incremental = edit(positions, categories, [second], null, base),
    cold = edit(positions, categories, [first, second]);
  assert.deepEqual(incremental, cold);
  assert.deepEqual(
    [
      ...edit(positions, categories, [], command("p", box(-0.4, 0.4)))
        .highlights,
    ],
    [1, 0],
  );
  assert.deepEqual([...categories], [2, 3]);
  assert.deepEqual(
    [
      ...edit(positions, categories, [], null, null, {
        2: "#ff0000",
      }).colors.slice(0, 3),
    ],
    [1, 0, 0],
  );
});
test("node spatial pruning never excludes known selected points", () => {
  const node = {
    box: new THREE.Box3(
      new THREE.Vector3(-0.1, -0.1, -0.1),
      new THREE.Vector3(0.1, 0.1, 0.1),
    ),
  };
  const runtime = { mayAffect: PointCloudRuntime.prototype.mayAffect };
  assert.equal(runtime.mayAffect(node, command("a", box(-0.3, 0.3))), true);
  assert.equal(runtime.mayAffect(node, command("b", box(0.5, 1))), false);
  assert.equal(
    runtime.mayAffect(node, { ...command("c", box(0.5, 1)), invert: true }),
    true,
  );
  const farScope = {
    center: [10, 10, 10],
    half: [1, 1, 1],
    angle: Math.PI / 4,
  };
  assert.equal(
    runtime.mayAffect(node, {
      ...command("d", box(-1, 1)),
      scope: farScope,
      invert: true,
    }),
    false,
  );
  const expr = combineSelection(box(0.5, 1), box(-1, 1), "union");
  assert.equal(runtime.mayAffect(node, command("e", expr)), true);
});
