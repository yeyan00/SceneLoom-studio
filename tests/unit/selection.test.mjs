import test from "node:test";
import assert from "node:assert/strict";
import { selectTests, suites } from "../runner/selection.mjs";
test("regression selection covers narrow changes and conservative fallbacks", () => {
  assert.deepEqual(selectTests(["docs/design.md"]).suites, []);
  assert.deepEqual(selectTests(["tests/README.md"]).suites, []);
  assert.deepEqual(selectTests(["src\\locales\\en.mjs"]).suites, [
    "unit",
    "ui",
    "brush",
    "forestry",
    "chm",
    "labels",
    "gaussian",
    "tiles",
  ]);
  assert.deepEqual(selectTests(["server/logs.mjs"]).suites, [
    "unit",
    "integration",
    "dock",
  ]);
  assert.ok(selectTests(["shared/edits.mjs"]).suites.includes("browser"));
  assert.deepEqual(selectTests(["src/new-core.js"]).suites, suites);
  assert.deepEqual(selectTests(["package-lock.json"]).suites, suites);
  assert.deepEqual(selectTests(["vendor/supersplat/src/editor.ts"]).suites, [
    "integration",
    "gaussian",
  ]);
  assert.deepEqual(selectTests(["src/views/tiles-runtime.js"]).suites, [
    "integration",
    "tiles",
  ]);
});
