import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { startTestServer } from "../helpers/server.mjs";
import {
  createForestFixture,
  createPotreeFixture,
} from "../fixtures/generate.mjs";
import { forestryState } from "../../shared/forestry.mjs";

test("CHM scans all LOD nodes; preview, atomic apply, save, undo, package, counters and cancellation", async () => {
  const service = await startTestServer();
  try {
    const source = await createForestFixture(path.join(service.home, "forest"));
    const original = await readFile(path.join(source, "octree.bin"));
    const { dataset: ds } = await service.api("/open", { path: source });
    const base = `/datasets/${ds.id}`;
    assert.equal(
      (await service.api(base + "/tree-id", { valueType: "uint16" })).treeId,
      1,
    );
    const job = await service.api(base + "/chm", {
      operations: [],
      policy: "unassigned",
      valueType: "uint16",
      parameters: {
        terrainResolution: 1,
        seedDistance: 4,
        tileSize: 8,
        overlap: 4,
      },
    });
    let result;
    for (let i = 0; i < 100; i++) {
      result = await service.api(base + "/chm/" + job.id + "/result");
      if (result.status !== "running") break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(result.status, "succeeded", result.error);
    assert.equal(result.summary.treeCount, 2);
    assert.equal(result.summary.stats.scannedPoints, ds.metadata.points);
    assert.equal(result.summary.stats.nodes, 2);
    assert.ok(result.summary.stats.tileCount > 1);
    assert.ok(result.summary.stats.mergedInstances > 0);
    assert.equal(
      (await service.api(base + "/session")).operations.length,
      0,
      "preview changed history",
    );
    const { command } = await service.api(
      base + "/chm/" + job.id + "/apply",
      {},
    );
    assert.deepEqual(
      command.trees.map((t) => t.id),
      [2, 3],
    );
    assert.deepEqual(
      result.preview.grid.labels,
      command.grid.labels,
      "preview colors used provisional IDs",
    );
    assert.deepEqual(
      (await service.api(base + "/chm/" + job.id + "/apply", {})).command,
      command,
      "apply retry reserved new IDs",
    );
    const session = {
      ...ds.session,
      sourceRevision: ds.revision,
      operations: [command],
      cursor: 1,
    };
    await service.api(base + "/save", session);
    assert.equal(
      forestryState(
        (await service.api("/open", { path: ds.projectPath })).dataset.session
          .operations,
      ).trees.length,
      2,
    );
    await service.api(base + "/session", { ...session, cursor: 0 });
    assert.equal(
      forestryState(
        (await service.api(base + "/session")).operations.slice(0, 0),
      ).trees.length,
      0,
    );
    await service.api(base + "/save", session);
    assert.equal(
      (await service.api(base + "/tree-id", { valueType: "uint16" })).treeId,
      4,
    );
    const backup = await service.api(base + "/backup", {
      directory: path.join(service.home, "backup"),
    });
    const packed = await service.api("/open", { path: backup.path });
    assert.deepEqual(packed.dataset.session.operations[0].grid, command.grid);
    assert.deepEqual(await readFile(path.join(source, "octree.bin")), original);
    const region = { center: [5, 5, 20], half: [4, 4, 20], angle: 0 };
    const local = await service.api(base + "/chm", {
      operations: [command],
      scope: region,
      policy: "replace",
      parameters: { terrainResolution: 1, seedDistance: 4 },
    });
    for (let i = 0; i < 100; i++) {
      result = await service.api(base + "/chm/" + local.id);
      if (result.status !== "running") break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(result.status, "succeeded");
    assert.equal(result.summary.treeCount, 1);
    const cancelled = await service.api(base + "/chm", {
      operations: [],
      policy: "unassigned",
    });
    assert.equal(
      (await service.api(base + "/chm/" + cancelled.id + "/cancel", {})).status,
      "cancelled",
    );
    await assert.rejects(() =>
      service.api(base + "/chm/" + cancelled.id + "/apply", {}),
    );
    const invalid = await service.api(base + "/chm", {
      operations: [],
      policy: "unassigned",
      parameters: { resolution: 0.1 },
    });
    await writeFile(
      path.join(source, "metadata.json"),
      JSON.stringify({ ...ds.metadata, name: "Changed" }),
    );
    for (let i = 0; i < 100; i++) {
      result = await service.api(base + "/chm/" + invalid.id);
      if (result.status !== "running") break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(result.status, "failed");
  } finally {
    await service.close();
  }
});
test("stream reader follows hierarchy proxies and fails on truncated blocks", async () => {
  const { scanPotree } = await import("../../server/chm/potree-reader.mjs");
  const service = await startTestServer();
  try {
    const folder = await createPotreeFixture(path.join(service.home, "proxy"));
    const meta = JSON.parse(
      await readFile(path.join(folder, "metadata.json"), "utf8"),
    );
    let n = 0;
    const scanned = await scanPotree(folder, meta, () => n++);
    assert.equal(n, 100000);
    assert.equal(scanned.nodes, 5);
    await writeFile(path.join(folder, "octree.bin"), Buffer.alloc(1));
    await assert.rejects(() => scanPotree(folder, meta, () => {}));
  } finally {
    await service.close();
  }
});
