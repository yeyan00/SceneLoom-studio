import { open } from "node:fs/promises";
import { regionBounds } from "../../shared/selection.mjs";

async function read(handle, offset, size) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || size < 0)
    throw new Error("点云块范围无效");
  const buffer = Buffer.alloc(size);
  let used = 0;
  while (used < size) {
    const { bytesRead } = await handle.read(
      buffer,
      used,
      size - used,
      offset + used,
    );
    if (!bytesRead) throw new Error("点云文件被截断");
    used += bytesRead;
  }
  return buffer;
}
// Every data node, including internal LOD nodes, contains distinct source points.
// Proxy records refer to hierarchy chunks, not octree point blocks.
export async function scanPotree(
  folder,
  metadata,
  visit,
  progress = () => {},
  scope = null,
) {
  if (
    metadata.version !== "2.0" ||
    !["DEFAULT", "UNCOMPRESSED"].includes(metadata.encoding)
  )
    throw new Error("CHM 仅支持未压缩 Potree 2.0");
  const hierarchy = await open(folder + "/hierarchy.bin", "r"),
    octree = await open(folder + "/octree.bin", "r");
  let count = 0,
    nodes = 0,
    accounted = 0;
  try {
    const hs = (await hierarchy.stat()).size,
      os = (await octree.stat()).size;
    const box = {
      min: metadata.boundingBox.min.map((v, i) => v - metadata.offset[i]),
      max: metadata.boundingBox.max.map((v, i) => v - metadata.offset[i]),
    };
    const clip = scope ? regionBounds(scope) : null;
    const intersects = (b) =>
      !clip ||
      b.min.every((v, i) => v <= clip.max[i] && b.max[i] >= clip.min[i]);
    const pending = [[0, metadata.hierarchy.firstChunkSize, box]],
      seen = new Set();
    const stride = metadata.attributes.reduce((n, a) => n + a.size, 0);
    let position = -1,
      classification = -1,
      offset = 0;
    for (const a of metadata.attributes) {
      if (a.name === "position") {
        if (a.type !== "int32" || a.size !== 12)
          throw new Error("不支持的位置属性");
        position = offset;
      }
      if (a.name === "classification") classification = offset;
      offset += a.size;
    }
    if (position < 0 || !Number.isSafeInteger(stride) || stride < 12)
      throw new Error("点属性布局无效");
    const batch = Math.max(1, Math.floor((4 * 1024 * 1024) / stride));
    while (pending.length) {
      const [at, size, rootBox] = pending.pop(),
        key = at + ":" + size;
      if (
        seen.has(key) ||
        size % 22 ||
        size > 64 * 1024 * 1024 ||
        at + size > hs
      )
        throw new Error("层级结构无效");
      seen.add(key);
      const chunk = await read(hierarchy, at, size);
      const queue = [rootBox];
      for (let p = 0; p < size; p += 22) {
        const nodeBox = queue[p / 22];
        if (!nodeBox) throw new Error("层级结构无效");
        const type = chunk[p],
          n = chunk.readUInt32LE(p + 2),
          start = Number(chunk.readBigUInt64LE(p + 6)),
          bytes = Number(chunk.readBigUInt64LE(p + 14));
        if (type === 2) {
          pending.push([start, bytes, nodeBox]);
          continue;
        }
        for (let c = 0; c < 8; c++)
          if (chunk[p + 1] & (1 << c)) {
            const child = {
              min: nodeBox.min.slice(),
              max: nodeBox.max.slice(),
            };
            for (let k = 0; k < 3; k++) {
              const mid = (nodeBox.min[k] + nodeBox.max[k]) / 2;
              if (c & (1 << (2 - k))) child.min[k] = mid;
              else child.max[k] = mid;
            }
            queue.push(child);
          }
        if (
          type > 1 ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(bytes) ||
          bytes !== n * stride ||
          start + bytes > os
        )
          throw new Error("点云块长度无效");
        if (!intersects(nodeBox)) {
          accounted += n;
          nodes++;
          progress({
            scannedPoints: count,
            processedPoints: accounted,
            totalPoints: metadata.points,
            nodes,
          });
          continue;
        }
        for (let first = 0; first < n; first += batch) {
          const length = Math.min(batch, n - first),
            data = await read(octree, start + first * stride, length * stride);
          for (let i = 0; i < length; i++) {
            const q = i * stride + position;
            visit(
              Math.fround(data.readInt32LE(q) * metadata.scale[0]),
              Math.fround(data.readInt32LE(q + 4) * metadata.scale[1]),
              Math.fround(data.readInt32LE(q + 8) * metadata.scale[2]),
              classification < 0 ? 0 : data[i * stride + classification],
            );
          }
          count += length;
          accounted += length;
          progress({
            scannedPoints: count,
            processedPoints: accounted,
            totalPoints: metadata.points,
            nodes,
          });
        }
        nodes++;
      }
    }
    if (accounted !== metadata.points)
      throw new Error("层级点数与元数据不一致");
    return { scannedPoints: count, processedPoints: accounted, nodes };
  } finally {
    await hierarchy.close();
    await octree.close();
  }
}
