import test from "node:test";
import assert from "node:assert/strict";
import { decode, edit } from "../../src/pointcloud/worker.js";
const attributes = [
  { name: "position", size: 12 },
  { name: "classification", size: 1 },
  { name: "rgb", size: 6, elementSize: 2 },
];
test("decode interleaved Potree points with extra fields, scale and 16-bit RGB", () => {
  const buffer = new ArrayBuffer(38),
    v = new DataView(buffer);
  for (let i = 0; i < 2; i++) {
    v.setInt32(i * 19, 100 + i, true);
    v.setInt32(i * 19 + 4, -200, true);
    v.setInt32(i * 19 + 8, 30, true);
    v.setUint8(i * 19 + 12, 5);
    v.setUint16(i * 19 + 13, 65280, true);
    v.setUint16(i * 19 + 15, 128, true);
    v.setUint16(i * 19 + 17, 0, true);
  }
  const decoded = decode(buffer, { attributes, scale: [0.01, 0.01, 0.01] }, 2);
  assert.ok(Math.abs(decoded.positions[0] - 1) < 1e-6);
  assert.equal(decoded.positions[1], -2);
  assert.deepEqual([...decoded.categories], [5, 5]);
  assert.equal(decoded.rgb[0], 1);
  assert.ok(Math.abs(decoded.rgb[1] - 128 / 255) < 1e-6);
  assert.throws(() => decode(buffer, { attributes, scale: [1, 1, 1] }, 3));
});
test("node overlay excludes deleted points without modifying source arrays", () => {
  const positions = new Float32Array([0, 0, 0, 0.8, 0, 0]),
    categories = new Uint8Array([2, 6]);
  const rule = {
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    polygon: [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ],
    invert: false,
    type: "delete",
  };
  assert.deepEqual([...edit(positions, categories, [rule]).indices], [1]);
  assert.deepEqual([...categories], [2, 6]);
  assert.deepEqual([...edit(positions, categories, []).indices], [0, 1]);
});
