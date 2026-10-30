import test from "node:test";
import assert from "node:assert/strict";
import { translate } from "../../src/locales/translate.mjs";
import english from "../../src/locales/en.mjs";
test("locales interpolate values, keep unknown/user labels and preserve zero", () => {
  assert.equal(
    translate("en", "可见 {0} / {1} 点", { 0: 0, 1: 200 }),
    "Displayed 0 / 200 points",
  );
  assert.equal(translate("zh-CN", "赋予类别 {0}", { 0: 5 }), "赋予类别 5");
  assert.equal(translate("en", "my custom class"), "my custom class");
  for (const [key, value] of Object.entries(english)) {
    assert.deepEqual(
      [...key.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(),
      [...value.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(),
      key,
    );
  }
});
