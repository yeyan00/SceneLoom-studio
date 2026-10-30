import test from "node:test";
import assert from "node:assert/strict";
import { dockReducer, emptyDock } from "../../src/panels/dock-state.mjs";

test("panels open independently, preserve other panels on close and restore after collapse", () => {
  let state = dockReducer(emptyDock, { type: "open", id: "tools" });
  assert.deepEqual(state.open, ["tools"]);
  state = dockReducer(state, { type: "open", id: "forestry" });
  state = dockReducer(state, { type: "open", id: "tools" });
  assert.deepEqual(state.open, ["tools", "forestry"]);
  state = dockReducer(state, { type: "close", id: "tools" });
  assert.equal(state.active, "forestry");
  assert.deepEqual(state.open, ["forestry"]);
  state = dockReducer(state, { type: "collapse" });
  assert.equal(state.collapsed, true);
  state = dockReducer(state, { type: "open", id: "tasks" });
  assert.equal(state.collapsed, false);
  assert.deepEqual(state.open, ["forestry", "tasks"]);
  state = dockReducer(state, { type: "close", id: "forestry" });
  assert.equal(state.active, "tasks");
  state = dockReducer(state, { type: "close", id: "tasks" });
  assert.equal(state.active, null);
  assert.deepEqual(state.open, []);
});
