import { writeFile } from "node:fs/promises";
// Uncompressed reference layout, no external downloads needed for regressions.
export async function createGaussianFixture(file, count = 512) {
  const fields = [
    "x",
    "y",
    "z",
    "f_dc_0",
    "f_dc_1",
    "f_dc_2",
    "opacity",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
  ];
  const header = Buffer.from(
    `ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${fields.map((name) => `property float ${name}`).join("\n")}\nend_header\n`,
  );
  const body = Buffer.alloc(count * fields.length * 4);
  for (let i = 0; i < count; i++) {
    const angle = i * 2.399963;
    const y = 1 - (2 * (i + 0.5)) / count,
      r = Math.sqrt(1 - y * y);
    const values = [
      r * Math.cos(angle),
      y,
      r * Math.sin(angle),
      1.5,
      -0.5,
      -0.7,
      4,
      -2.8,
      -2.8,
      -2.8,
      1,
      0,
      0,
      0,
    ];
    values.forEach((v, k) => body.writeFloatLE(v, (i * fields.length + k) * 4));
  }
  await writeFile(file, Buffer.concat([header, body]));
  return file;
}
