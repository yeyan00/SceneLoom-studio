import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
export async function startTestServer({
  production = true,
  checkBuild = production,
  tools,
  isolatedProjects = true,
  requestTimeout = 30000,
} = {}) {
  if (checkBuild)
    await access(path.join(projectRoot, "dist/index.html")).catch(() => {
      throw new Error("Build the app first: npm run build");
    });
  const home = await mkdtemp(path.join(os.tmpdir(), "sceneloom-regression-"));
  const toolDirectory = path.join(home, "tools");
  await mkdir(toolDirectory);
  if (tools) {
    try {
      await tools(toolDirectory);
    } catch (error) {
      await rm(home, { recursive: true, force: true });
      throw error;
    }
  }
  const child = spawn(
    process.execPath,
    ["server/index.mjs", ...(production ? ["--production"] : [])],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: "0",
        SCENELOOM_HOME: path.join(home, "state"),
        SCENELOOM_PROJECT_ROOT: isolatedProjects
          ? path.join(home, "projects")
          : "",
        SCENELOOM_TOOLS: toolDirectory,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "",
    stdout = "",
    closed = false;
  child.stderr.on("data", (b) => (stderr = (stderr + b).slice(-16000)));
  child.stdout.on("data", (b) => (stdout += b));
  async function close() {
    if (closed) return;
    closed = true;
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    }
    await rm(home, { recursive: true, force: true });
  }
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Test service startup timed out: " + stderr));
      }, 15000);
      function cleanup() {
        clearTimeout(timer);
        child.off("exit", onExit);
        child.off("error", onError);
        child.stdout.off("data", onData);
      }
      function onExit(code) {
        cleanup();
        reject(new Error(`Test service exited ${code}: ${stderr}`));
      }
      function onError(error) {
        cleanup();
        reject(error);
      }
      function onData() {
        const match = stdout.match(/SceneLoom (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) {
          cleanup();
          resolve(match[1]);
        }
      }
      child.stdout.on("data", onData);
      child.on("exit", onExit);
      child.on("error", onError);
      onData();
    });
    return {
      url,
      home,
      close,
      api: async (route, value) => {
        const response = await fetch(url + "/api" + route, {
          signal: AbortSignal.timeout(requestTimeout),
          ...(value === undefined
            ? {}
            : {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(value),
              }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        return data;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
