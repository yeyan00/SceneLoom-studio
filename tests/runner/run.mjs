import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { selectTests, suites } from "./selection.mjs";
import { projectRoot } from "../helpers/server.mjs";
const args = process.argv.slice(2),
  profile = args.shift() || "quick";
function run(command, argv) {
  const result = spawnSync(command, argv, {
    cwd: projectRoot,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
let selected;
if (profile === "related") {
  let files = [];
  const index = args.indexOf("--files");
  if (index >= 0)
    files = args.slice(index + 1).filter((value) => !value.startsWith("--"));
  else {
    const base = args.indexOf("--base");
    const commands = [
      ["diff", "--name-only", "-z", ...(base >= 0 ? [args[base + 1]] : [])],
      ["diff", "--cached", "--name-only", "-z"],
      ["ls-files", "--others", "--exclude-standard", "-z"],
    ];
    for (const command of commands) {
      const result = spawnSync("git", command, {
        cwd: projectRoot,
        encoding: "utf8",
      });
      if (result.status !== 0) {
        if (command.includes("HEAD")) continue;
        throw new Error(result.stderr);
      }
      files.push(...result.stdout.split("\0").filter(Boolean));
    }
    if (!files.length) {
      const result = spawnSync("git", ["diff", "--name-only"], {
        cwd: projectRoot,
        encoding: "utf8",
      });
      files = result.stdout.split(/\r?\n/).filter(Boolean);
    }
  }
  const selection = selectTests([...new Set(files)]);
  selected = selection.suites;
  console.log(JSON.stringify(selection, null, 2));
} else
  selected =
    profile === "quick"
      ? ["unit", "integration"]
      : profile === "release"
        ? suites
        : profile === "e2e"
          ? [
              "browser",
              "ui",
              "dock",
              "workspace",
              "package",
              "brush",
              "forestry",
              "chm",
              "labels",
              "gaussian",
              "tiles",
            ]
          : [profile];
if (selected.some((suite) => !suites.includes(suite)))
  throw new Error("Unknown test profile: " + profile);
console.log(
  "Regression suites: " + (selected.join(", ") || "none (no runtime changes)"),
);
if (args.includes("--plan")) process.exit(0);
if (
  selected.some((suite) =>
    [
      "browser",
      "ui",
      "dock",
      "workspace",
      "package",
      "brush",
      "forestry",
      "chm",
      "labels",
      "gaussian",
      "tiles",
    ].includes(suite),
  )
)
  run(process.execPath, ["node_modules/vite/bin/vite.js", "build"]);
for (const suite of selected) {
  if (suite === "ui") run(process.execPath, ["tests/e2e/ribbon-check.mjs"]);
  if (suite === "ui") run(process.execPath, ["tests/e2e/data-tree-check.mjs"]);
  if (["unit", "integration"].includes(suite))
    run(process.execPath, [
      "--test",
      ...readdirSync(`tests/${suite}`)
        .filter((file) => file.endsWith(".test.mjs"))
        .map((file) => `tests/${suite}/${file}`),
    ]);
  else
    run(process.execPath, [
      suite === "converter"
        ? "tests/integration/converter-check.mjs"
        : `tests/e2e/${suite}-check.mjs`,
      ...(["gaussian", "tiles"].includes(suite) && args.includes("--public")
        ? ["--public"]
        : []),
    ]);
}
