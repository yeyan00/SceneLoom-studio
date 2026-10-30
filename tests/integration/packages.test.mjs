import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  rename,
  readdir,
  utimes,
  open,
  stat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createPotreeFixture } from "../fixtures/generate.mjs";
import { openProject, closeProjects } from "../../server/project-store.mjs";
import { datasetIdentity } from "../../server/dataset-identity.mjs";
import {
  createPackageManager,
  scanProjects,
} from "../../server/project-packages.mjs";
import { startTestServer } from "../helpers/server.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function finished(manager, id) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const job = manager.get(id);
    if (!["queued", "preparing", "running", "cancelling"].includes(job.status))
      return job;
    await sleep(5);
  }
  throw new Error("Package timeout");
}
async function fixture(root, name, original = false) {
  const folder = await createPotreeFixture(path.join(root, name)),
    identity = await datasetIdentity(folder),
    directory = folder + ".sceneloom";
  const source = original ? path.join(root, name + ".las") : undefined;
  if (source) await writeFile(source, "original-las-fixture");
  const store = await openProject({
    stateDir: path.join(root, "state"),
    id: name,
    folder,
    revision: identity.revision,
    metadata: identity.metadata,
    projectDirectory: directory,
    originalSource: source,
  });
  store.save(
    {
      sourceRevision: identity.revision,
      operations: [],
      cursor: 0,
      workspace: { region: null },
    },
    true,
  );
  await mkdir(path.join(directory, "attributes"));
  await writeFile(
    path.join(directory, "attributes", "treeID.bin"),
    Buffer.from([1, 2, 3, 4]),
  );
  return { folder, store, directory };
}
test("mixed batch packaging survives relocation without source data; originals optional and collisions safe", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sceneloom-package-"));
  let service;
  try {
    const source = path.join(root, "inputs");
    await mkdir(source);
    const a = await fixture(source, "A", true),
      b = await fixture(source, "B");
    const manager = createPackageManager({
      stateDir: path.join(root, "state"),
    });
    const destination = path.join(root, "output");
    const scanned = await scanProjects(source);
    assert.equal(scanned.projects.length, 2);
    const options = {
      projects: [a.store.entry, b.store.entry],
      destination,
      includeOriginal: true,
      collision: "rename",
    };
    const job = await finished(manager, manager.start(options).id);
    assert.equal(job.status, "succeeded", JSON.stringify(job));
    assert.equal(job.items.length, 2);
    assert.equal(job.completedBytes, job.totalBytes);
    const aEntry = job.items[0].entry,
      bEntry = job.items[1].entry;
    assert.equal(
      JSON.parse(await readFile(aEntry, "utf8")).database,
      "project.db",
    );
    assert.equal(
      await readFile(
        path.join(path.dirname(aEntry), "original", "A.las"),
        "utf8",
      ),
      "original-las-fixture",
    );
    assert.equal(
      JSON.parse(await readFile(bEntry, "utf8")).originalSource,
      undefined,
    );
    assert.deepEqual(
      [
        ...(await readFile(
          path.join(path.dirname(bEntry), "attributes", "treeID.bin"),
        )),
      ],
      [1, 2, 3, 4],
    );
    const skipped = await finished(
      manager,
      manager.start({ ...options, collision: "skip" }).id,
    );
    assert.ok(skipped.items.every((item) => item.status === "skipped"));
    const renamed = await finished(manager, manager.start(options).id);
    assert.ok(renamed.items.every((item) => item.output.includes("(2)")));
    closeProjects();
    await rename(source, path.join(root, "unavailable"));
    const moved = path.join(root, "moved");
    await rename(destination, moved);
    const newEntry = path.join(
      moved,
      path.basename(path.dirname(aEntry)),
      "project.sceneloom.json",
    );
    // Simulate a transfer that changes timestamps: checksums preserve the saved data identity.
    await utimes(
      path.join(path.dirname(newEntry), "pointcloud", "octree.bin"),
      new Date(),
      new Date(),
    );
    service = await startTestServer({ checkBuild: false });
    const reopened = await service.api("/open", { path: newEntry });
    assert.equal(reopened.dataset.session.cursor, 0);
    assert.equal(reopened.dataset.id, "A");
    await service.api(`/datasets/${reopened.dataset.id}/save`, {
      ...reopened.dataset.session,
      sourceRevision: reopened.dataset.revision,
    });
    const db = new DatabaseSync(
      path.join(path.dirname(newEntry), "project.db"),
      { readOnly: true },
    );
    assert.equal(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    db.close();
    const originalBytes = await stat(
      path.join(root, "unavailable", "A", "octree.bin"),
    );
    assert.equal(originalBytes.size, 1900000);
  } finally {
    await service?.close();
    closeProjects();
    await rm(root, { recursive: true, force: true });
  }
});
test("cancel removes partial output, a bad project does not prevent valid projects, nesting is rejected", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "sceneloom-package-cancel-"),
  );
  try {
    const a = await fixture(root, "A"),
      large = await open(
        path.join(a.directory, "attributes", "large.bin"),
        "w",
      );
    await large.truncate(64 * 1024 * 1024);
    await large.close();
    const manager = createPackageManager({
      stateDir: path.join(root, "state"),
      copyHighWaterMark: 4096,
    });
    const destination = path.join(root, "output"),
      started = manager.start({ projects: [a.store.entry], destination });
    const deadline = Date.now() + 15000;
    while (
      manager.get(started.id).completedBytes < 1024 * 1024 &&
      Date.now() < deadline
    )
      await sleep(1);
    manager.cancel(started.id);
    const cancelled = await finished(manager, started.id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.items[0].status, "cancelled");
    assert.deepEqual(await readdir(destination), []);
    await rm(path.join(a.directory, "attributes", "large.bin"));
    const partial = await finished(
      manager,
      manager.start({
        projects: [path.join(root, "missing.sceneloom.json"), a.store.entry],
        destination,
      }).id,
    );
    assert.equal(partial.status, "completedWithErrors");
    assert.equal(partial.items[1].status, "succeeded");
    const nested = await finished(
      manager,
      manager.start({
        projects: [a.store.entry],
        destination: path.join(a.folder, "nested"),
      }).id,
    );
    assert.equal(nested.items[0].status, "failed");
    assert.match(nested.items[0].error, /目标目录/);
  } finally {
    closeProjects();
    await rm(root, { recursive: true, force: true });
  }
});
test("direct Potree opens in place with a sibling project and no point-data copy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sceneloom-reference-"));
  let service;
  try {
    const folder = await createPotreeFixture(path.join(root, "direct"));
    service = await startTestServer({
      checkBuild: false,
      isolatedProjects: false,
    });
    const opened = await service.api("/open", { path: folder });
    assert.equal(
      opened.dataset.projectPath,
      path.join(root, "direct.sceneloom", "project.sceneloom.json"),
    );
    assert.deepEqual((await readdir(folder)).sort(), [
      "hierarchy.bin",
      "metadata.json",
      "octree.bin",
    ]);
    const entry = JSON.parse(
      await readFile(opened.dataset.projectPath, "utf8"),
    );
    assert.equal(entry.dataset.source, path.join("..", "direct"));
    assert.equal(entry.database, "project.db");
    assert.ok(
      !(await readdir(path.dirname(opened.dataset.projectPath))).includes(
        "pointcloud",
      ),
    );
    const reopened = await service.api("/open", { path: folder });
    assert.equal(reopened.dataset.id, opened.dataset.id);
    const listed = await service.api("/directories", { path: root });
    assert.ok(
      listed.directories.some((item) => item.name === "direct.sceneloom"),
    );
  } finally {
    await service?.close();
    closeProjects();
    await rm(root, { recursive: true, force: true });
  }
});
