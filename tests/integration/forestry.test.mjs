import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { startTestServer } from "../helpers/server.mjs";
import { createPotreeFixture } from "../fixtures/generate.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { openProject, closeProjects } from "../../server/project-store.mjs";
test("v1 migration preserves history, reconstructs ID counter and refuses uint16 overflow", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "sceneloom-forest-migrate-"),
  );
  try {
    const args = {
      stateDir: root,
      folder: path.join(root, "source"),
      id: "legacy",
      revision: "r1",
      metadata: { attributes: [] },
    };
    let store = await openProject(args);
    store.save(
      {
        operations: [
          {
            id: "old-tree",
            payloadVersion: 2,
            type: "createTree",
            treeId: 1,
            valueType: "uint16",
            name: "Legacy",
          },
        ],
        cursor: 1,
      },
      true,
    );
    closeProjects();
    const db = new DatabaseSync(path.join(args.folder, "project.db"));
    db.exec(
      "DROP TABLE entity_id_counters;DELETE FROM schema_migrations WHERE version>=2;PRAGMA user_version=1;",
    );
    db.close();
    store = await openProject(args);
    assert.equal(store.load().saved.operations[0].name, "Legacy");
    assert.equal(store.allocateTreeId("uint16"), 2);
    const bounded = await openProject({
      ...args,
      folder: path.join(root, "bounded"),
      id: "bounded",
      metadata: {
        attributes: [
          {
            name: "treeID",
            type: "uint16",
            size: 2,
            numElements: 1,
            max: [65534],
          },
        ],
      },
    });
    assert.equal(bounded.allocateTreeId("uint16"), 65535);
    assert.throws(() => bounded.allocateTreeId("uint16"));
    assert.throws(() => bounded.allocateTreeId("uint32"));
  } finally {
    closeProjects();
    await rm(root, { recursive: true, force: true });
  }
});
test("tree IDs are reserved without reuse; entity commands, branch history and package survive reopen", async () => {
  const server = await startTestServer({ production: false });
  try {
    const fixture = await createPotreeFixture(path.join(server.home, "points"));
    let { dataset } = await server.api("/open", { path: fixture });
    const reserved = await Promise.all(
      Array.from({ length: 4 }, () =>
        server.api("/datasets/" + dataset.id + "/tree-id", {
          valueType: "uint16",
        }),
      ),
    );
    assert.deepEqual(
      reserved.map((r) => r.treeId).sort((a, b) => a - b),
      [1, 2, 3, 4],
    );
    const create = {
      id: "tree-create",
      payloadVersion: 2,
      type: "createTree",
      treeId: 1,
      name: "Oak",
      valueType: "uint16",
    };
    const value = {
      sourceRevision: dataset.revision,
      operations: [create],
      cursor: 1,
    };
    await server.api("/datasets/" + dataset.id + "/save", value);
    await server.api("/datasets/" + dataset.id + "/session", {
      ...value,
      cursor: 0,
    });
    ({ dataset } = await server.api("/open", { path: dataset.projectPath }));
    assert.equal(dataset.session.cursor, 0);
    assert.equal(dataset.session.operations[0].treeId, 1);
    assert.equal(
      (
        await server.api("/datasets/" + dataset.id + "/tree-id", {
          valueType: "uint16",
        })
      ).treeId,
      5,
    );
    await assert.rejects(
      server.api("/datasets/" + dataset.id + "/save", {
        ...value,
        operations: [{ ...create, treeId: 65536 }],
      }),
    );
    await server.api("/datasets/" + dataset.id + "/save", value);
    const job = await server.api("/packages", {
      projects: [dataset.projectPath],
      destination: path.join(server.home, "packed"),
      collision: "rename",
    });
    let result;
    for (let i = 0; i < 200; i++) {
      result = await server.api("/packages/" + job.id);
      if (!["queued", "preparing", "running"].includes(result.status)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(result.status, "succeeded");
    const packed = (await server.api("/open", { path: result.items[0].entry }))
      .dataset;
    assert.equal(packed.session.operations[0].name, "Oak");
    assert.equal(
      (
        await server.api("/datasets/" + packed.id + "/tree-id", {
          valueType: "uint16",
        })
      ).treeId,
      6,
    );
  } finally {
    await server.close();
  }
});
