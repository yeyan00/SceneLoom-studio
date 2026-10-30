import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openProject, closeProjects } from "../../server/project-store.mjs";
test("legacy home project and sqlite extension migrate with saved and recovery history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sceneloom-migrate-"));
  try {
    const legacy = path.join(root, "projects", "legacy");
    const args = {
      stateDir: root,
      id: "legacy",
      folder: path.join(root, "source"),
      revision: "v1",
      metadata: { points: 10 },
    };
    const original = await openProject({ ...args, projectDirectory: legacy });
    original.save(
      { operations: [{ id: "first", type: "delete" }], cursor: 1 },
      true,
    );
    original.save(
      {
        operations: [
          { id: "first", type: "delete" },
          { id: "second", type: "delete" },
        ],
        cursor: 2,
      },
      false,
    );
    closeProjects();
    await rename(
      path.join(legacy, "project.db"),
      path.join(legacy, "project.sqlite"),
    );
    const index = JSON.parse(await readFile(original.entry, "utf8"));
    index.database = "project.sqlite";
    await writeFile(original.entry, JSON.stringify(index));
    const migrated = await openProject({
      ...args,
      projectDirectory: args.folder + ".sceneloom",
    });
    assert.equal(migrated.load().saved.cursor, 1);
    assert.equal(migrated.load().session.cursor, 2);
    assert.equal(migrated.load().recovered, true);
    assert.equal(
      JSON.parse(await readFile(migrated.entry, "utf8")).database,
      "project.db",
    );
    closeProjects();
    const inPlace = await openProject({ ...args, indexPath: original.entry });
    assert.equal(inPlace.load().session.cursor, 2);
    assert.equal(
      JSON.parse(await readFile(original.entry, "utf8")).database,
      "project.db",
    );
  } finally {
    closeProjects();
    await rm(root, { recursive: true, force: true });
  }
});
test("SQLite saved/recovery snapshots, immutable branches and WAL-safe backup reopen", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sceneloom-db-"));
  try {
    const args = {
      stateDir: root,
      id: "fixture",
      folder: path.join(root, "source"),
      revision: "v1",
      metadata: { points: 100 },
    };
    let store = await openProject(args);
    const command = { id: "a", type: "classify", category: 5 };
    const saved = store.save(
      { operations: [command], cursor: 1, workspace: { region: null } },
      true,
    );
    store.save(
      { operations: [command, { id: "b", type: "delete" }], cursor: 2 },
      false,
    );
    assert.equal(store.load().saved.cursor, 1);
    assert.equal(store.load().session.cursor, 2);
    assert.equal(store.load().recovered, true);
    assert.throws(() =>
      store.save(
        { operations: [{ ...command, category: 7 }], cursor: 1 },
        true,
      ),
    );
    assert.equal(store.load().saved.cursor, 1);
    const backup = await store.backupTo(path.join(root, "backup"));
    const index = JSON.parse(await readFile(backup, "utf8"));
    assert.equal(index.database, "project.db");
    closeProjects();
    store = await openProject({ ...args, indexPath: backup });
    assert.equal(store.load().saved.savedAt, saved.savedAt);
    assert.equal(store.load().session.cursor, 2);
    store.save(
      {
        operations: [command, { id: "c", type: "classify", category: 7 }],
        cursor: 2,
      },
      true,
    );
    assert.equal(store.load().recovered, false);
    store.save(
      {
        operations: [
          command,
          { id: "c", type: "classify", category: 7 },
          { id: "d", type: "delete" },
        ],
        cursor: 2,
      },
      false,
    );
    assert.equal(store.load().recovered, false);
    assert.equal(store.load().session.operations.length, 3);
    const db = new DatabaseSync(path.join(path.dirname(backup), "project.db"), {
      readOnly: true,
    });
    assert.equal(
      db.prepare("SELECT count(*) AS count FROM edit_commands").get().count,
      4,
    );
    assert.equal(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    db.close();
    const original = await openProject(args);
    assert.equal(original.load().session.operations[1].id, "b");
    await assert.rejects(
      openProject({ ...args, revision: "v2", indexPath: backup }),
    );
  } finally {
    closeProjects();
    await rm(root, { recursive: true, force: true });
  }
});
