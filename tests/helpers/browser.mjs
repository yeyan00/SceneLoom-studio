import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./server.mjs";
const require = createRequire(import.meta.url);
export const artifactDirectory =
  process.env.SCENELOOM_TEST_ARTIFACTS ||
  path.join(
    projectRoot,
    "test-results",
    new Date().toISOString().replace(/[:.]/g, "-") + "-" + process.pid,
  );
export function createBrowser(name) {
  let cli = process.env.PLAYWRIGHT_CLI_JS;
  if (!cli) {
    try {
      cli = require.resolve("@playwright/cli/playwright-cli.js");
    } catch {
      cli = path.join(
        path.dirname(process.execPath),
        "node_modules",
        "@playwright",
        "cli",
        "playwright-cli.js",
      );
    }
  }
  if (!existsSync(cli))
    throw new Error(
      "playwright-cli was not found. Set PLAYWRIGHT_CLI_JS to its installed script.",
    );
  mkdirSync(artifactDirectory, { recursive: true });
  const session = `regression-${name}-${process.pid}`;
  function run(...args) {
    const result = spawnSync(
      process.execPath,
      [cli, `-s=${session}`, ...args],
      { cwd: projectRoot, encoding: "utf8", maxBuffer: 8e6, timeout: 180000 },
    );
    if (
      result.error ||
      result.status !== 0 ||
      result.stdout?.includes("### Error")
    )
      throw new Error(
        result.error?.message || `${result.stdout}\n${result.stderr}`,
      );
    return result.stdout;
  }
  return {
    open: (url) => run("open", url),
    run: (code) => {
      const output = run("run-code", code);
      if (!output.includes("### Result"))
        throw new Error("Browser check did not return a result:\n" + output);
      const result = output.slice(0, output.indexOf("### Ran Playwright code"));
      console.log(result);
      return result;
    },
    close: () => run("close"),
    artifacts: artifactDirectory,
  };
}
