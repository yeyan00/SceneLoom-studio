import path from "node:path";
import { promises as fs, createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";

export function inspectGaussianHeader(buffer, size) {
  const text = buffer.toString("ascii");
  const end = /(?:^|\n)end_header\r?\n/.exec(text);
  if (!/^ply\r?\n/.test(text) || !end)
    throw new Error("无效的 PLY 文件头（最大 64 KiB）");
  const header = text.slice(0, end.index + end[0].length);
  if (header.includes("\r"))
    throw new Error("3DGS 当前支持 LF 换行的 PLY 文件头");
  if (!/^format binary_little_endian 1\.0\r?$/m.test(header))
    throw new Error("3DGS 当前支持 binary_little_endian PLY");
  const elements = [];
  let current;
  for (const line of header.split(/\r?\n/)) {
    const element = /^element (\w+) (\d+)$/.exec(line);
    const property = /^property (\w+) (\w+)$/.exec(line);
    if (element) {
      current = { name: element[1], count: Number(element[2]), properties: [] };
      elements.push(current);
    } else if (property && current)
      current.properties.push({ type: property[1], name: property[2] });
    else if (line.startsWith("property "))
      throw new Error("不支持的 PLY 属性定义");
  }
  const vertex = elements.find((e) => e.name === "vertex");
  if (!vertex || !Number.isSafeInteger(vertex.count) || vertex.count < 1)
    throw new Error("PLY 没有有效的 Gaussian 数据");
  const has = (names, element = vertex) =>
    names.every((name) => element.properties.some((p) => p.name === name));
  const ordinary = has([
    "x",
    "y",
    "z",
    "opacity",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
    "f_dc_0",
    "f_dc_1",
    "f_dc_2",
  ]);
  const chunk = elements.find((e) => e.name === "chunk");
  const compressed =
    !!chunk &&
    chunk.count === Math.ceil(vertex.count / 256) &&
    has(["packed_position", "packed_rotation", "packed_scale", "packed_color"]);
  if (!ordinary && !compressed)
    throw new Error(
      "这是普通点云 PLY 或不支持的 Gaussian PLY，不含完整 3DGS 属性",
    );
  const widths = {
    char: 1,
    uchar: 1,
    short: 2,
    ushort: 2,
    int: 4,
    uint: 4,
    float: 4,
    double: 8,
  };
  let bytes = Buffer.byteLength(header, "ascii");
  for (const e of elements) {
    if (!Number.isSafeInteger(e.count)) throw new Error("PLY 元素数量无效");
    const stride = e.properties.reduce((n, p) => n + (widths[p.type] || 0), 0);
    if (e.properties.some((p) => !widths[p.type]) || !stride)
      throw new Error("不支持的 PLY 属性类型");
    bytes += e.count * stride;
  }
  if (!Number.isSafeInteger(bytes) || bytes > size)
    throw new Error("PLY 数据不完整");
  return {
    count: vertex.count,
    encoding: compressed ? "compressed-ply" : "gaussian-ply",
  };
}

export function validateSplatView(value) {
  if (
    !value ||
    !/^#[\da-f]{6}$/i.test(value.background) ||
    !["original", "flip-yz"].includes(value.orientation)
  )
    throw new Error("无效的 3DGS 显示设置");
  if (value.camera !== null && value.camera !== undefined) {
    for (const key of ["position", "target"])
      if (
        !Array.isArray(value.camera[key]) ||
        value.camera[key].length !== 3 ||
        value.camera[key].some((n) => !Number.isFinite(n) || Math.abs(n) > 1e12)
      )
        throw new Error("无效的 3DGS 相机状态");
  }
  return {
    background: value.background,
    orientation: value.orientation,
    camera: value.camera
      ? {
          position: [...value.camera.position],
          target: [...value.camera.target],
        }
      : null,
  };
}

export function createSplatStore(stateDir) {
  const index = path.join(stateDir, "splat-views.json");
  const entries = new Map();
  let queue = Promise.resolve();
  const persist = () => {
    const data = JSON.stringify(
      { version: 1, views: [...entries.values()] },
      null,
      2,
    );
    const job = queue.then(async () => {
      const temp = `${index}.${randomUUID()}.tmp`;
      await fs.writeFile(temp, data);
      await fs.rename(temp, index);
    });
    queue = job.catch(() => {});
    return job;
  };
  const publicEntry = ({ path: source, ...entry }) => ({
    ...entry,
    path: source,
    url: `/api/splats/${entry.id}/file`,
  });
  async function describe(source) {
    const absolute = path.resolve(source);
    if (!/\.(ply|ssproj)$/i.test(absolute))
      throw new Error("请选择 Gaussian PLY 或 SSProj 工程");
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new Error("请选择 Gaussian PLY 文件");
    const handle = await fs.open(absolute, "r");
    let info;
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, 65536));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (/\.ssproj$/i.test(absolute)) {
        if (bytesRead < 4 || buffer.readUInt32LE(0) !== 0x04034b50)
          throw new Error("无效的 SSProj 工程");
        info = { count: 0, encoding: "supersplat-project" };
      } else
        info = inspectGaussianHeader(buffer.subarray(0, bytesRead), stat.size);
    } finally {
      await handle.close();
    }
    const id = createHash("sha256")
      .update(absolute + `:${stat.size}:${stat.mtimeMs}`)
      .digest("hex")
      .slice(0, 24);
    return {
      id,
      type: "gaussian",
      name: path.basename(absolute),
      path: absolute,
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      ...info,
    };
  }
  return {
    list() {
      return [...entries.values()].map(publicEntry);
    },
    async restore() {
      let saved;
      try {
        saved = JSON.parse(await fs.readFile(index, "utf8"));
      } catch (e) {
        if (e.code === "ENOENT") return { views: [], unavailable: [] };
        throw e;
      }
      const unavailable = [];
      for (const v of saved.views || []) {
        try {
          const entry = await describe(v.path);
          if (entry.id !== v.id) throw new Error("源文件已变化，请重新打开");
          entries.set(entry.id, { ...entry, view: validateSplatView(v.view) });
        } catch (e) {
          unavailable.push({ name: v.name, error: e.message });
        }
      }
      return { views: [...entries.values()].map(publicEntry), unavailable };
    },
    async open(source) {
      const entry = await describe(source);
      if (!entries.has(entry.id) && entries.size >= 12)
        throw new Error("最多打开 12 个 3DGS 视图，请先关闭部分视图");
      // A changed source replaces its old view, never reuses its camera implicitly.
      for (const [id, old] of entries)
        if (old.path === entry.path && id !== entry.id) entries.delete(id);
      entries.set(entry.id, {
        ...entry,
        view: entries.get(entry.id)?.view || {
          background: "#18212d",
          orientation: "original",
          camera: null,
        },
      });
      await persist();
      return publicEntry(entries.get(entry.id));
    },
    async update(id, view) {
      const entry = entries.get(id);
      if (!entry) throw new Error("3DGS 视图已关闭，请重新打开");
      entry.view = validateSplatView(view);
      await persist();
      return publicEntry(entry);
    },
    async close(id) {
      entries.delete(id);
      await persist();
      return { closed: true };
    },
    async stream(id, req, res) {
      const entry = entries.get(id);
      if (!entry) throw new Error("3DGS 视图已关闭，请重新打开");
      const stat = await fs.stat(entry.path);
      if (stat.size !== entry.bytes || stat.mtimeMs !== entry.mtimeMs)
        throw new Error("源文件已变化，请重新打开");
      let start = 0,
        end = stat.size - 1;
      if (req.headers.range) {
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        start = range ? Number(range[1]) : NaN;
        end = range?.[2] ? Number(range[2]) : end;
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
      res.writeHead(req.headers.range ? 206 : 200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
        ...(req.headers.range
          ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` }
          : {}),
      });
      if (req.method === "HEAD") return res.end();
      const stream = createReadStream(entry.path, { start, end });
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    },
  };
}
