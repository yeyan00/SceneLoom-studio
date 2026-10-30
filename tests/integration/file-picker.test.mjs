import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { startTestServer } from "../helpers/server.mjs";

test("local picker browses directories and filters files by data type without reading file contents", async () => {
  const service = await startTestServer({ checkBuild: false });
  try {
    const directory = path.join(service.home, "picker");
    await mkdir(path.join(directory, "nested"), { recursive: true });
    for (const name of [
      "scan.LAS",
      "metadata.json",
      "tileset.json",
      "model.ply",
      "session.ssproj",
      "workspace.sceneloom.json",
      "ignore.txt",
    ])
      await writeFile(path.join(directory, name), "fixture");
    const folders = await service.api("/directories", { path: directory });
    assert.deepEqual(
      folders.directories.map((item) => item.name),
      ["nested"],
    );
    assert.equal(folders.files, undefined);
    const gs = await service.api("/directories", {
      path: directory,
      includeFiles: true,
      type: "gaussian",
    });
    assert.deepEqual(
      gs.files.map((item) => item.name),
      ["model.ply", "session.ssproj"],
    );
    const project = await service.api("/directories", {
      path: path.join(directory, "model.ply"),
      includeFiles: true,
      type: "project",
    });
    assert.equal(project.path, directory);
    assert.deepEqual(
      project.files.map((item) => item.name),
      ["workspace.sceneloom.json"],
    );
    const points = await service.api("/directories", {
      path: directory,
      includeFiles: true,
      type: "pointcloud",
    });
    assert.ok(points.files.some((item) => item.name === "scan.LAS"));
    assert.ok(
      !points.files.some(
        (item) => item.name.endsWith(".ply") || item.name.endsWith(".txt"),
      ),
    );
    await assert.rejects(
      service.api("/directories", {
        path: directory,
        includeFiles: true,
        type: "invalid",
      }),
    );
  } finally {
    await service.close();
  }
});
