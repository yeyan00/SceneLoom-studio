import test from "node:test";
import assert from "node:assert/strict";
import { validateTool, toolArguments } from "../../server/tools.mjs";
test("tool manifests limit tree depth and reject invalid parameter references", () => {
  const tool = {
    id: "local.tool",
    title: "Test",
    category: ["Automation", "Cloud"],
    executable: "example.exe",
    args: ["--source", "{source}"],
    parameters: [
      { id: "source", label: "Source", type: "file", required: true },
    ],
  };
  assert.equal(validateTool(tool).category.length, 2);
  assert.throws(() => validateTool({ ...tool, category: ["A", "B", "C"] }));
  assert.throws(() => validateTool({ ...tool, args: ["{missing}"] }));
  assert.throws(() => toolArguments(tool, {}));
  const input = "D:\a b\cloud.las; $(example) & test";
  assert.deepEqual(toolArguments(tool, { source: input }), ["--source", input]);
});
