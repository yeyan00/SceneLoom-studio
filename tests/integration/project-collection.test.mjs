import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { startTestServer } from "../helpers/server.mjs";
import { createPotreeFixture } from "../fixtures/generate.mjs";
import { createGaussianFixture } from "../fixtures/gaussian.mjs";
import { createTilesFixture } from "../fixtures/tiles.mjs";

test("mixed project references restore multiple datasets, independent point histories and missing sources", async () => {
  const service = await startTestServer();
  const post = (route, value) =>
    fetch(service.url + "/api" + route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  try {
    const points = [];
    for (const name of ["first", "second"]) {
      const source = await createPotreeFixture(path.join(service.home, name));
      const response = await post("/open", {
        path: source,
        type: "pointcloud",
      });
      assert.equal(response.status, 200, await response.clone().text());
      points.push((await response.json()).dataset);
    }
    const saved = await post(`/datasets/${points[0].id}/session`, {
      sourceRevision: points[0].revision,
      operations: [],
      cursor: 0,
      workspace: { region: null, maximized: "top", single: true },
    });
    assert.equal(saved.status, 200, await saved.clone().text());
    const gaussian = await createGaussianFixture(
      path.join(service.home, "model.ply"),
    );
    const tiles = await createTilesFixture(path.join(service.home, "tiles"));
    const file = path.join(service.home, "mixed.sceneloom.json");
    const resources = [
      ...points.map((item) => ({ type: "pointcloud", path: item.projectPath })),
      { type: "gaussian", path: gaussian },
      { type: "tiles", path: tiles },
      { type: "gaussian", path: path.join(service.home, "missing.ply") },
    ];
    const response = await post("/project-collection", {
      path: file,
      resources: [...resources, resources[0]],
    });
    assert.equal(response.status, 200, await response.clone().text());
    const index = JSON.parse(await readFile(file, "utf8"));
    assert.equal(index.version, 2);
    assert.equal(index.resources.length, 5);
    assert.ok(index.resources.every((item) => !path.isAbsolute(item.path)));
    const opened = await post("/open", { path: file, type: "project" });
    assert.equal(opened.status, 200, await opened.clone().text());
    const result = await opened.json();
    assert.equal(result.kind, "project");
    assert.deepEqual(
      result.results.map((item) => item.kind),
      ["potree", "potree", "gaussian", "tiles"],
    );
    assert.deepEqual(
      result.results.slice(0, 2).map((item) => item.dataset.id),
      points.map((item) => item.id),
    );
    assert.equal(result.results[0].dataset.session.workspace.maximized, "top");
    assert.equal(
      result.results[1].dataset.session.workspace?.maximized,
      undefined,
    );
    assert.equal(result.unavailable.length, 1);
    assert.equal(result.unavailable[0].type, "gaussian");
    assert.equal(result.unavailable[0].path, resources[4].path);
    for (const resource of [
      { path: gaussian, type: "pointcloud" },
      { path: tiles, type: "gaussian" },
    ]) {
      const mismatch = await post("/open", resource);
      assert.equal(mismatch.status, 400);
      assert.match((await mismatch.json()).error, /类型不匹配/);
    }
    const existing = await readFile(points[0].projectPath, "utf8");
    assert.equal(
      (
        await post("/project-collection", {
          path: points[0].projectPath,
          resources,
        })
      ).status,
      400,
    );
    assert.equal(await readFile(points[0].projectPath, "utf8"), existing);
    await writeFile(
      file,
      JSON.stringify({
        format: "SceneLoom",
        version: 2,
        resources: [{ type: "gaussian", path: file }],
      }),
    );
    const cycle = await (await post("/open", { path: file })).json();
    assert.equal(cycle.results.length, 0);
    assert.equal(cycle.unavailable.length, 1);
  } finally {
    await service.close();
  }
});
