import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const commit = "a30bfdf2d6cc55f4c3078e8aea3a793af6ebfd56";
const folder = "1.0/TilesetWithDiscreteLOD";
export async function downloadTilesSample() {
  const output = fileURLToPath(
    new URL("../../test-results/samples/tiles-dragon/", import.meta.url),
  );
  await mkdir(output, { recursive: true });
  const records = [];
  for (const name of [
    "tileset.json",
    "dragon_low.b3dm",
    "dragon_medium.b3dm",
    "dragon_high.b3dm",
    "README.md",
  ]) {
    const url = `https://api.github.com/repos/CesiumGS/3d-tiles-samples/contents/${folder}/${name}?ref=${commit}`;
    const file = path.join(output, name);
    let bytes;
    try {
      bytes = await readFile(file);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (!bytes) {
      const response = await fetch(url, {
        headers: { Accept: "application/vnd.github.raw+json" },
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok)
        throw new Error(`Sample download ${response.status}: ${name}`);
      bytes = Buffer.from(await response.arrayBuffer());
      await writeFile(file, bytes);
    }
    records.push({
      name,
      url,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await writeFile(
    path.join(output, "source.json"),
    JSON.stringify(
      {
        repository: "CesiumGS/3d-tiles-samples",
        commit,
        folder,
        files: records,
      },
      null,
      2,
    ),
  );
  return path.join(output, "tileset.json");
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(await downloadTilesSample());
