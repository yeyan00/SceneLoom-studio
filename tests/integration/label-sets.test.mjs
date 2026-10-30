import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { startTestServer } from "../helpers/server.mjs";
import { createForestFixture } from "../fixtures/generate.mjs";
import { lasLabelSet } from "../../shared/label-sets.mjs";

const definition = () => ({
  id: "building-is-two",
  name: "Project standard A",
  version: 1,
  classes: [
    {
      id: 2,
      name: "Building",
      aliases: ["建筑"],
      semantic: "building",
      color: "#ff0000",
    },
    {
      id: 42,
      name: "Ground",
      aliases: ["地面"],
      semantic: "ground",
      color: "#00ff00",
    },
    {
      id: 5,
      name: "Trees",
      aliases: ["树木"],
      semantic: "vegetation",
      color: "#0000ff",
    },
  ],
});
test("label library CRUD, revision conflicts and project snapshots survive packaging without library", async () => {
  const service = await startTestServer();
  try {
    const builtin = (await service.api("/label-sets")).labelSets[0];
    assert.equal(builtin.id, lasLabelSet().id);
    await assert.rejects(() =>
      service.api("/label-sets", {
        action: "delete",
        id: builtin.id,
        expectedVersion: 1,
      }),
    );
    const first = await service.api("/label-sets", {
      action: "save",
      labelSet: definition(),
      expectedVersion: 0,
    });
    assert.equal(first.labelSet.version, 1);
    const concurrent = await Promise.allSettled(
      [1, 2].map((n) =>
        service.api("/label-sets", {
          action: "save",
          labelSet: { ...first.labelSet, name: "Revision " + n },
          expectedVersion: 1,
        }),
      ),
    );
    assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((r) => r.status === "rejected").length, 1);
    const folder = await createForestFixture(path.join(service.home, "points"));
    const original = await readFile(path.join(folder, "octree.bin"));
    const { dataset: ds } = await service.api("/open", { path: folder });
    const state = {
      ...ds.session,
      sourceRevision: ds.revision,
      labelSet: first.labelSet,
      classes: first.labelSet.classes,
    };
    await service.api(`/datasets/${ds.id}/save`, state);
    const modified = structuredClone(first.labelSet);
    modified.classes[0].aliases.push("roof");
    modified.version = 2;
    await service.api(`/datasets/${ds.id}/session`, {
      ...state,
      labelSet: modified,
      classes: modified.classes,
    });
    const recovered = (await service.api("/open", { path: ds.projectPath }))
      .dataset;
    assert.equal(recovered.recovered, true);
    assert.ok(recovered.session.labelSet.classes[0].aliases.includes("roof"));
    await service.api(`/datasets/${ds.id}/save`, state);
    const backup = await service.api(`/datasets/${ds.id}/backup`, {
      directory: path.join(service.home, "portable"),
    });
    await service.api("/label-sets", {
      action: "delete",
      id: first.labelSet.id,
      expectedVersion: 2,
    });
    const packed = (await service.api("/open", { path: backup.path })).dataset;
    assert.deepEqual(packed.session.labelSet, first.labelSet);
    assert.equal((await service.api("/label-sets")).labelSets.length, 1);
    assert.deepEqual(await readFile(path.join(folder, "octree.bin")), original);
    await assert.rejects(() =>
      service.api(`/datasets/${ds.id}/save`, { ...state, classes: [] }),
    );
    // Current source class 2 means building in this standard; no ground-42
    // points exist, so auto mode must estimate rather than use class 2.
    const task = await service.api(`/datasets/${ds.id}/chm`, {
      operations: [],
      policy: "unassigned",
      labelSet: first.labelSet,
      parameters: { terrainResolution: 1, seedDistance: 4 },
    });
    let result;
    for (let i = 0; i < 100; i++) {
      result = await service.api(`/datasets/${ds.id}/chm/${task.id}`);
      if (result.status !== "running") break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(result.status, "succeeded", result.error);
    assert.equal(result.summary.stats.groundMethod, "morphological");
    assert.equal(result.summary.stats.groundPoints, 0);
  } finally {
    await service.close();
  }
});
