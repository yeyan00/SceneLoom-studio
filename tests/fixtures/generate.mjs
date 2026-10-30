import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
export async function createForestFixture(folder) {
  await mkdir(folder, { recursive: true });
  const ground = [],
    canopy = [];
  for (let y = 0; y <= 10; y += 0.5)
    for (let x = 0; x <= 20; x += 0.5) {
      const g = 10 + 0.2 * x + 0.1 * y;
      ground.push([x, y, g, 2]);
      for (const cx of [5, 15]) {
        const d = Math.hypot(x - cx, y - 5);
        if (d <= 3) canopy.push([x, y, g + 12 - d * d * 0.8, 5]);
      }
    }
  const stride = 13,
    chunks = [ground, canopy].map((points) => {
      const b = Buffer.alloc(points.length * stride);
      points.forEach((p, i) => {
        for (let k = 0; k < 3; k++)
          b.writeInt32LE(Math.round(p[k] * 100), i * stride + k * 4);
        b[i * stride + 12] = p[3];
      });
      return b;
    });
  const hierarchy = Buffer.alloc(44);
  hierarchy[0] = 0;
  hierarchy[1] = 1;
  hierarchy.writeUInt32LE(ground.length, 2);
  hierarchy.writeBigUInt64LE(BigInt(chunks[0].length), 14);
  hierarchy[22] = 1;
  hierarchy.writeUInt32LE(canopy.length, 24);
  hierarchy.writeBigUInt64LE(BigInt(chunks[0].length), 28);
  hierarchy.writeBigUInt64LE(BigInt(chunks[1].length), 36);
  const offset = [1000000, 2000000, 100],
    min = offset.map((v, i) => v + [0, 0, 10][i]),
    max = offset.map((v, i) => v + [20, 10, 28][i]);
  const metadata = {
    version: "2.0",
    encoding: "UNCOMPRESSED",
    name: "Sloped two-tree forest",
    points: ground.length + canopy.length,
    offset,
    scale: [0.01, 0.01, 0.01],
    spacing: 1,
    boundingBox: { min: offset, max: offset.map((v) => v + 64) },
    hierarchy: { firstChunkSize: 44, stepSize: 4, depth: 1 },
    attributes: [
      {
        name: "position",
        size: 12,
        elementSize: 4,
        numElements: 3,
        type: "int32",
        min,
        max,
      },
      {
        name: "classification",
        size: 1,
        elementSize: 1,
        numElements: 1,
        type: "uint8",
        min: [2],
        max: [5],
      },
    ],
  };
  await writeFile(path.join(folder, "metadata.json"), JSON.stringify(metadata));
  await writeFile(path.join(folder, "hierarchy.bin"), hierarchy);
  await writeFile(path.join(folder, "octree.bin"), Buffer.concat(chunks));
  return folder;
}
export async function createPotreeFixture(folder) {
  await mkdir(folder, { recursive: true });
  const count = 20000,
    keys = ["r", "r0", "r2", "r4", "r6"],
    stride = 19,
    chunks = [],
    hierarchy = Buffer.alloc(22 * 6);
  let byteOffset = 0;
  for (let n = 0; n < keys.length; n++) {
    const chunk = Buffer.alloc(count * stride);
    for (let i = 0; i < count; i++) {
      const u = (i % 200) / 199,
        v = Math.floor(i / 200) / 99;
      const child = n ? Number(keys[n][1]) : 0;
      const x = n ? u * 32 + (child & 4 ? 32 : 0) : u * 64,
        y = n ? v * 32 + (child & 2 ? 32 : 0) : v * 64,
        z = 6 + 3 * Math.sin(x * 0.2) * Math.cos(y * 0.15) + (n ? 1 : 0);
      const p = i * stride;
      for (const [k, val] of [x, y, z].entries())
        chunk.writeInt32LE(Math.round(val * 100), p + k * 4);
      chunk[p + 12] = 2 + ((i + n) % 5);
      chunk.writeUInt16LE(Math.round(64 + u * 180) * 256, p + 13);
      chunk.writeUInt16LE(Math.round(30 + v * 200) * 256, p + 15);
      chunk.writeUInt16LE(Math.round(190 - u * 130) * 256, p + 17);
    }
    const row = n === 4 ? 5 : n,
      pos = row * 22;
    hierarchy[pos] = n === 0 ? 0 : 1;
    hierarchy[pos + 1] = n === 0 ? 0b01010101 : 0;
    hierarchy.writeUInt32LE(count, pos + 2);
    hierarchy.writeBigUInt64LE(BigInt(byteOffset), pos + 6);
    hierarchy.writeBigUInt64LE(BigInt(chunk.length), pos + 14);
    if (n === 4) {
      hierarchy[4 * 22] = 2;
      hierarchy.writeUInt32LE(count, 4 * 22 + 2);
      hierarchy.writeBigUInt64LE(110n, 4 * 22 + 6);
      hierarchy.writeBigUInt64LE(22n, 4 * 22 + 14);
    }
    chunks.push(chunk);
    byteOffset += chunk.length;
  }
  const offset = [1935460, 583689, -49];
  const min = offset,
    max = offset.map((v, i) => v + [64, 64, 12][i]);
  const metadata = {
    version: "2.0",
    name: "Regression fixture",
    encoding: "DEFAULT",
    points: count * keys.length,
    offset,
    scale: [0.01, 0.01, 0.01],
    spacing: 8,
    boundingBox: { min, max: offset.map((v) => v + 64) },
    hierarchy: { firstChunkSize: 110, stepSize: 4, depth: 1 },
    attributes: [
      {
        name: "position",
        size: 12,
        elementSize: 4,
        numElements: 3,
        type: "int32",
        min,
        max,
      },
      {
        name: "classification",
        size: 1,
        elementSize: 1,
        numElements: 1,
        type: "uint8",
        min: [2],
        max: [6],
      },
      {
        name: "rgb",
        size: 6,
        elementSize: 2,
        numElements: 3,
        type: "uint16",
        min: [0, 0, 0],
        max: [65280, 65280, 65280],
      },
    ],
  };
  await writeFile(path.join(folder, "metadata.json"), JSON.stringify(metadata));
  await writeFile(path.join(folder, "hierarchy.bin"), hierarchy);
  await writeFile(path.join(folder, "octree.bin"), Buffer.concat(chunks));
  return folder;
}
export async function createLasFixture(file, count = 50000) {
  await mkdir(path.dirname(file), { recursive: true });
  const header = Buffer.alloc(227),
    data = Buffer.alloc(count * 26);
  header.write("LASF");
  header[24] = 1;
  header[25] = 2;
  header.writeUInt16LE(227, 94);
  header.writeUInt32LE(227, 96);
  header[104] = 2;
  header.writeUInt16LE(26, 105);
  header.writeUInt32LE(count, 107);
  header.writeUInt32LE(count, 111);
  for (let k = 0; k < 3; k++) {
    header.writeDoubleLE(0.01, 131 + k * 8);
    header.writeDoubleLE(k === 2 ? 10 : 100, 179 + k * 16);
    header.writeDoubleLE(0, 187 + k * 16);
  }
  for (let i = 0; i < count; i++) {
    const p = i * 26;
    data.writeInt32LE(i % 10001, p);
    data.writeInt32LE((i * 7) % 10001, p + 4);
    data.writeInt32LE((i * 3) % 1001, p + 8);
    data[p + 14] = 9;
    data[p + 15] = 2;
    for (let k = 0; k < 3; k++)
      data.writeUInt16LE(((i + k * 60) % 256) * 256, p + 20 + k * 2);
  }
  await writeFile(file, Buffer.concat([header, data]));
  return file;
}
