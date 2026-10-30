import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import { startTestServer } from "../helpers/server.mjs";
import { createTilesFixture } from "../fixtures/tiles.mjs";
test("3D Tiles registers, persists camera, serves nested files and rejects escaped paths", async () => {
  const service = await startTestServer();
  try {
    const source = await createTilesFixture(path.join(service.home, "tiles"));
    const post = async (route, value) =>
      fetch(service.url + "/api" + route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
    const response = await post("/open", { path: path.dirname(source) });
    assert.equal(response.status, 200);
    const { view, kind } = await response.json();
    assert.equal(kind, "tiles");
    const root = await fetch(service.url + view.url);
    assert.equal(root.status, 200);
    assert.equal((await root.json()).root.children.length, 1);
    const prefix = service.url + view.url.replace("tileset.json", "");
    const tile = await fetch(prefix + "nested/model.b3dm", {
      headers: { Range: "bytes=0-3" },
    });
    assert.equal(tile.status, 206);
    assert.equal(await tile.text(), "b3dm");
    const outside = path.join(service.home, "outside.bin");
    await writeFile(outside, "private");
    assert.notEqual((await fetch(prefix + "%2e%2e%2foutside.bin")).status, 200);
    assert.equal(
      (await fetch(prefix + "nested/model.b3dm", { method: "HEAD" })).status,
      200,
    );
    const camera = { position: [1, 2, 3], target: [0, 0, 0] };
    assert.equal(
      (await post(`/tiles/${view.id}/view-state`, camera)).status,
      200,
    );
    assert.equal(
      (
        await post(`/tiles/${view.id}/view-state`, {
          position: [null, 0, 0],
          target: [0, 0, 0],
        })
      ).status,
      400,
    );
    const entries = JSON.parse(
      await readFile(
        path.join(service.home, "state", "tiles-views.json"),
        "utf8",
      ),
    );
    assert.deepEqual(entries[0].view, camera);
    await writeFile(path.join(service.home, "bad.json"), "{}");
    assert.equal(
      (await post("/open", { path: path.join(service.home, "bad.json") }))
        .status,
      400,
    );
    await post(`/tiles/${view.id}/close`, {});
    assert.equal((await fetch(service.url + view.url)).status, 400);
  } finally {
    await service.close();
  }
});
