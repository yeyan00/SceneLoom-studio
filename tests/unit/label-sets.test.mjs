import test from "node:test";
import assert from "node:assert/strict";
import {
  lasLabelSet,
  validateLabelSet,
  validateLabelSession,
  labelSetForSession,
  chmSemantics,
  matchesClass,
} from "../../shared/label-sets.mjs";
import { editSignature } from "../../shared/history.mjs";
import { createAccumulator, finishChm } from "../../server/chm/algorithm.mjs";
import { pointTreeValue } from "../../shared/forestry.mjs";

export const custom = () => ({
  id: "project-standard",
  name: "Custom project",
  version: 1,
  classes: [
    {
      id: 2,
      name: "Building",
      aliases: ["建筑", "house"],
      color: "#dfb6a1",
      semantic: "building",
    },
    {
      id: 42,
      name: "Terrain",
      aliases: ["地面"],
      color: "#cbb08b",
      semantic: "ground",
    },
    {
      id: 5,
      name: "Canopy",
      aliases: ["树冠"],
      color: "#24764c",
      semantic: "vegetation",
    },
  ],
});
test("LAS R15 labels are named in English, alias searchable, reserved flags not class meanings", () => {
  const standard = lasLabelSet();
  validateLabelSet(standard);
  assert.equal(standard.classes[0].name, "Created, never classified");
  assert.equal(standard.classes[1].name, "Unclassified");
  assert.equal(standard.classes.find((c) => c.id === 8).reserved, true);
  assert.equal(standard.classes.find((c) => c.id === 12).semantic, "none");
  assert.ok(matchesClass(standard.classes[2], "地面"));
  assert.ok(matchesClass(standard.classes[2], "GROUND"));
  assert.ok(matchesClass(standard.classes[2], "2"));
  const clone = lasLabelSet();
  clone.classes[2].name = "House";
  assert.throws(() => validateLabelSet(clone), /只读/);
  validateLabelSet({
    classes: standard.classes,
    version: standard.version,
    name: standard.name,
    id: standard.id,
    standard: standard.standard,
  });
  const duplicate = custom();
  duplicate.classes.push({ ...duplicate.classes[0] });
  assert.throws(() => validateLabelSet(duplicate));
  const mismatch = { labelSet: custom(), classes: lasLabelSet().classes };
  assert.throws(() => validateLabelSession(mismatch));
});
test("custom and legacy IDs never imply semantic meaning; project snapshots and dirty state include aliases", () => {
  const set = custom();
  validateLabelSet(set);
  assert.deepEqual(chmSemantics(set).groundIds, [42]);
  assert.deepEqual(chmSemantics(set).ignoreIds, [2]);
  const legacy = labelSetForSession({
    classes: [{ id: 2, name: "Ground", color: "#000000" }],
  });
  assert.deepEqual(chmSemantics(legacy).groundIds, []);
  assert.equal(labelSetForSession().id, lasLabelSet().id);
  const input = {
    labelSet: set,
    classes: set.classes,
    operations: [],
    cursor: 0,
  };
  const initial = editSignature(input);
  set.classes[0].aliases.push("roof");
  assert.notEqual(editSignature(input), initial);
  const copy = labelSetForSession({ labelSet: set });
  set.name = "Changed template";
  assert.equal(copy.name, "Custom project");
});
test("CHM uses ground 42, excludes building 2 and estimates terrain with no semantic ground", () => {
  for (const mapping of [chmSemantics(custom()), chmSemantics(null)]) {
    const a = createAccumulator(
      { min: [0, 0], max: [20, 10] },
      { ...mapping, groundMode: "auto", terrainResolution: 1, seedDistance: 4 },
    );
    for (let y = 0; y <= 10; y += 0.5)
      for (let x = 0; x <= 20; x += 0.5) {
        const g = 10 + 0.2 * x;
        a.add(x, y, g, 42);
        for (const cx of [5, 15]) {
          const d = Math.hypot(x - cx, y - 5);
          if (d <= 3) a.add(x, y, g + 12 - d * d * 0.8, 5);
        }
      }
    if (mapping.groundIds.length) a.add(10, 5, 1000, 2);
    const r = finishChm(a);
    assert.equal(r.treeCount, 2);
    assert.equal(
      r.stats.groundMethod,
      mapping.groundIds.length ? "classified" : "morphological",
    );
    const op = {
      type: "segmentTrees",
      grid: r.grid,
      policy: "replace",
      minHeight: 2,
      excludeCategories: mapping.excludeCategories,
    };
    if (mapping.groundIds.length)
      assert.equal(pointTreeValue(0, op, 5, 5, 24, null, 2), 0);
    assert.ok(pointTreeValue(0, op, 5, 5, 24, null, 5));
  }
});
