import test from "node:test";
import assert from "node:assert/strict";
import { dataFilters } from "../../shared/data-types.mjs";

test("picker filters separate overlapping PLY/JSON types and expose only implemented importers", () => {
  assert.deepEqual(dataFilters("pointcloud")[0].extensions, [
    "las",
    "laz",
    "json",
  ]);
  assert.deepEqual(dataFilters("gaussian")[0].extensions, ["ply", "ssproj"]);
  assert.equal(dataFilters("auto").length, 5);
  assert.equal(
    new Set(dataFilters("auto")[0].extensions).size,
    dataFilters("auto")[0].extensions.length,
  );
  assert.match(dataFilters("project")[0].name, /sceneloom/);
});
