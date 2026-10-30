import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createSplatStore,
  inspectGaussianHeader,
  validateSplatView,
} from "../../server/splats.mjs";
import { createGaussianFixture } from "../fixtures/gaussian.mjs";
import { startTestServer } from "../helpers/server.mjs";
test("Gaussian header detection, view persistence and source identity", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sceneloom-splat-"));
  try {
    const source = await createGaussianFixture(
      path.join(directory, "reference.ply"),
    );
    const before = await readFile(source);
    assert.equal(inspectGaussianHeader(before, before.length).count, 512);
    assert.throws(
      () => inspectGaussianHeader(before, before.length - 1),
      /PLY/,
    );
    assert.throws(
      () =>
        inspectGaussianHeader(
          Buffer.from(
            "ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nend_header\n",
          ),
          100,
        ),
      /Gaussian/,
    );
    assert.throws(
      () =>
        validateSplatView({
          background: "#18212d",
          orientation: "original",
          camera: { position: [Infinity, 0, 0], target: [0, 0, 0] },
        }),
      /3DGS/,
    );
    const store = createSplatStore(directory);
    const invalidProject = path.join(directory, "invalid.ssproj");
    await writeFile(invalidProject, "not a project");
    await assert.rejects(store.open(invalidProject), /SSProj/);
    const entry = await store.open(source);
    await store.update(entry.id, {
      background: "#ffffff",
      orientation: "flip-yz",
      camera: { position: [1, 2, 3], target: [0, 0, 0] },
    });
    const reopened = createSplatStore(directory);
    const restored = await reopened.restore();
    assert.equal(restored.views[0].view.background, "#ffffff");
    assert.deepEqual(await readFile(source), before);
    await writeFile(source, Buffer.concat([before, Buffer.from([0])]));
    assert.equal(
      (await createSplatStore(directory).restore()).unavailable.length,
      1,
    );
    const next = await store.open(source);
    assert.notEqual(next.id, entry.id);
    assert.equal(store.list().length, 1);
    assert.equal(next.view.camera, null);
    await store.close(next.id);
    assert.equal((await createSplatStore(directory).restore()).views.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("Gaussian API serves registered source ranges and rejects ordinary point PLY", async () => {
  const server = await startTestServer({ production: false });
  try {
    const source = await createGaussianFixture(
      path.join(server.home, "cloud.ply"),
    );
    const result = await server.api("/open", { path: source });
    assert.equal(result.kind, "gaussian");
    const response = await fetch(server.url + result.view.url, {
      headers: { Range: "bytes=0-3" },
    });
    assert.equal(response.status, 206);
    assert.equal(await response.text(), "ply\n");
    const head = await fetch(server.url + result.view.url, { method: "HEAD" });
    assert.equal(Number(head.headers.get("content-length")), result.view.bytes);
    const bad = await fetch(server.url + result.view.url, {
      headers: { Range: "bytes=999999999-" },
    });
    assert.equal(bad.status, 416);
    await server.api(`/splats/${result.view.id}/close`, {});
    assert.equal((await server.api("/splats")).views.length, 0);
    await writeFile(
      source,
      "ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nend_header\n",
    );
    await assert.rejects(
      () => server.api("/open", { path: source }),
      /普通点云 PLY/,
    );
  } finally {
    await server.close();
  }
});
