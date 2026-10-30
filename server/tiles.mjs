import path from "node:path";
import { promises as fs, createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";

export function createTilesStore(stateDir) {
  const entries = new Map(),
    index = path.join(stateDir, "tiles-views.json");
  let queue = Promise.resolve();
  const publicEntry = (e) => ({
    ...e,
    url: `/api/tiles/${e.id}/files/${encodeURIComponent(path.basename(e.path))}`,
  });
  const persist = () => {
    const data = JSON.stringify([...entries.values()]);
    const job = queue.then(async () => {
      const temp = index + "." + randomUUID();
      await fs.writeFile(temp, data);
      await fs.rename(temp, index);
    });
    queue = job.catch(() => {});
    return job;
  };
  async function describe(source) {
    let file = await fs.realpath(path.resolve(source));
    if ((await fs.stat(file)).isDirectory())
      file = await fs.realpath(path.join(file, "tileset.json"));
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024)
      throw new Error("Invalid or oversized tileset JSON");
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    if (
      !["1.0", "1.1"].includes(data.asset?.version) ||
      !data.root?.boundingVolume ||
      !Number.isFinite(data.geometricError) ||
      data.geometricError < 0
    )
      throw new Error("Invalid 3D Tiles tileset");
    const id = createHash("sha256")
      .update(file + ":" + stat.size + ":" + stat.mtimeMs)
      .digest("hex")
      .slice(0, 24);
    return {
      id,
      type: "tiles",
      name: path.basename(path.dirname(file)),
      path: file,
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      encoding: `3D Tiles ${data.asset.version}`,
    };
  }
  return {
    list: () => [...entries.values()].map(publicEntry),
    async restore() {
      const unavailable = [];
      let saved = [];
      try {
        saved = JSON.parse(await fs.readFile(index, "utf8"));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      for (const e of saved)
        try {
          const actual = await describe(e.path);
          if (actual.id !== e.id) throw new Error("Tileset source changed");
          entries.set(e.id, { ...actual, view: e.view || {} });
        } catch (error) {
          unavailable.push({ name: e.name, error: error.message });
        }
      return { views: this.list(), unavailable };
    },
    async open(source) {
      const e = await describe(source);
      if (!entries.has(e.id) && entries.size >= 12)
        throw new Error("Close an existing 3D Tiles view first");
      for (const [id, old] of entries)
        if (old.path === e.path && id !== e.id) entries.delete(id);
      entries.set(e.id, { ...e, view: entries.get(e.id)?.view || {} });
      await persist();
      return publicEntry(entries.get(e.id));
    },
    async close(id) {
      entries.delete(id);
      await persist();
      return { closed: true };
    },
    async update(id, view) {
      const e = entries.get(id);
      if (!e) throw new Error("3D Tiles view closed");
      if (
        !view ||
        !["position", "target"].every(
          (k) =>
            Array.isArray(view[k]) &&
            view[k].length === 3 &&
            view[k].every((n) => Number.isFinite(n) && Math.abs(n) < 1e12),
        )
      )
        throw new Error("Invalid tiles camera");
      e.view = { position: [...view.position], target: [...view.target] };
      await persist();
      return publicEntry(e);
    },
    async stream(id, relative, req, res) {
      const e = entries.get(id);
      if (!e) throw new Error("3D Tiles view closed");
      const root = path.dirname(e.path);
      if (relative.includes("\\") || path.isAbsolute(relative))
        throw new Error("Invalid tile path");
      const target = await fs.realpath(path.resolve(root, relative));
      const within = path.relative(root, target);
      if (
        within === ".." ||
        within.startsWith(".." + path.sep) ||
        path.isAbsolute(within)
      )
        throw new Error("Tile path escapes dataset directory");
      const stat = await fs.stat(target);
      if (!stat.isFile()) throw new Error("Tile is not a file");
      const source = await fs.stat(e.path);
      if (source.size !== e.bytes || source.mtimeMs !== e.mtimeMs)
        throw new Error("Tileset source changed; reopen the dataset");
      let start = 0,
        end = stat.size - 1;
      if (req.headers.range) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        start = m ? Number(m[1]) : NaN;
        end = m?.[2] ? Number(m[2]) : end;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          end >= stat.size
        ) {
          res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
          return res.end();
        }
      }
      const mime = {
        ".json": "application/json",
        ".gltf": "model/gltf+json",
        ".glb": "model/gltf-binary",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
      };
      res.writeHead(req.headers.range ? 206 : 200, {
        "Content-Type":
          mime[path.extname(target).toLowerCase()] ||
          "application/octet-stream",
        "Content-Length": Math.max(0, end - start + 1),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
        ...(req.headers.range
          ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` }
          : {}),
      });
      if (req.method === "HEAD" || stat.size === 0) return res.end();
      const stream = createReadStream(target, { start, end });
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    },
  };
}
