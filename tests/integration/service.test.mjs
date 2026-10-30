import { startTestServer } from "../helpers/server.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
test("service streams exact ranges, validates rules, persists and detects source mutations", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "sceneloom-test-"));
  const fixture = path.join(home, "fixture");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(fixture);
  const toolDirectory = path.join(home, "tools");
  await mkdir(toolDirectory);
  await writeFile(
    path.join(toolDirectory, "echo.json"),
    JSON.stringify({
      id: "test.echo",
      title: "Echo test",
      category: ["Automation", "Test"],
      executable: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1])", "{message}"],
      parameters: [
        { id: "message", label: "Message", type: "text", required: true },
      ],
    }),
  );
  const metadata = {
    version: "2.0",
    encoding: "DEFAULT",
    points: 1,
    boundingBox: { min: [0, 0, 0], max: [1, 1, 1] },
    attributes: [{ name: "position", size: 12 }],
    scale: [0.01, 0.01, 0.01],
    offset: [0, 0, 0],
    hierarchy: { firstChunkSize: 22 },
  };
  await writeFile(
    path.join(fixture, "metadata.json"),
    JSON.stringify(metadata),
  );
  await writeFile(path.join(fixture, "hierarchy.bin"), Buffer.alloc(22));
  await writeFile(
    path.join(fixture, "octree.bin"),
    Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  );
  const service = await startTestServer({
    production: true,
    checkBuild: false,
    tools: async (directory) => {
      await writeFile(
        path.join(directory, "echo.json"),
        await (
          await import("node:fs/promises")
        ).readFile(path.join(toolDirectory, "echo.json")),
      );
    },
  });
  try {
    const api = async (route, value) => {
      const r = await fetch(
        service.url + "/api" + route,
        value === undefined
          ? {}
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(value),
            },
      );
      return { r, value: await r.json() };
    };
    const tools = await api("/tools");
    assert.ok(tools.value.tools.some((tool) => tool.id === "test.echo"));
    assert.equal(
      (await api("/tools/test.echo/run", { parameters: {} })).r.status,
      400,
    );
    const message = "literal $(unused); & spaced text";
    const started = await api("/tools/test.echo/run", {
      parameters: { message },
    });
    let task;
    for (let i = 0; i < 100; i++) {
      task = (await api(`/jobs/${started.value.id}`)).value;
      if (task.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(task.status, "succeeded");
    assert.equal(task.log, message);
    await api("/logs", {
      level: "warn",
      message: "test warning",
      context: { jobId: task.id },
    });
    const logs = await api("/logs?level=warn&search=test");
    assert.ok(
      logs.value.entries.some((entry) => entry.message === "test warning"),
    );
    const exported = await fetch(service.url + "/api/logs/export");
    assert.match(await exported.text(), /test warning/);
    const { value: opened } = await api("/open", { path: fixture });
    assert.equal(opened.kind, "potree");
    const ds = opened.dataset,
      base = `${service.url}/api/datasets/${ds.id}/files/octree.bin`;
    const range = await fetch(base, { headers: { Range: "bytes=2-5" } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), "bytes 2-5/12");
    assert.deepEqual(
      [...new Uint8Array(await range.arrayBuffer())],
      [3, 4, 5, 6],
    );
    assert.equal(
      (await fetch(base, { headers: { Range: "bytes=99-100" } })).status,
      416,
    );
    const snapshot = { sourceRevision: ds.revision, operations: [], cursor: 0 };
    assert.equal(
      (await api(`/datasets/${ds.id}/save`, snapshot)).r.status,
      200,
    );
    assert.equal(
      (
        await api(`/datasets/${ds.id}/save`, {
          ...snapshot,
          sourceRevision: "wrong",
        })
      ).r.status,
      400,
    );
    assert.equal(
      (
        await api(`/datasets/${ds.id}/session`, {
          ...snapshot,
          operations: [{ type: "delete" }],
          cursor: 1,
        })
      ).r.status,
      400,
    );
    const reopened = await api("/open", { path: fixture });
    assert.ok(reopened.value.dataset.session.savedAt);
    const backedUp = await api(`/datasets/${ds.id}/backup`, {
      directory: path.join(home, "backup"),
    });
    assert.equal(backedUp.r.status, 200);
    const fromEntry = await api("/open", { path: backedUp.value.path });
    assert.equal(fromEntry.value.dataset.session.cursor, 0);
    assert.equal(fromEntry.value.dataset.projectPath, backedUp.value.path);
    assert.equal(
      (await fetch(base, { headers: { Origin: "https://example.com" } }))
        .status,
      403,
    );
    await writeFile(path.join(fixture, "octree.bin"), Buffer.alloc(24));
    assert.equal(
      (await api(`/datasets/${ds.id}/save`, snapshot)).r.status,
      409,
    );
    assert.equal(
      (await fetch(base, { headers: { Range: "bytes=0-2" } })).status,
      409,
    );
  } finally {
    await service.close();
    await rm(home, { recursive: true, force: true });
  }
});
