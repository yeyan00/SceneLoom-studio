import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const gaussianSample = {
  repository: "https://github.com/playcanvas/engine",
  revision: "7b4f9c0c08a3a22e9c9197a300ab75ca613ed24f",
  file: "examples/assets/splats/guitar.compressed.ply",
  bytes: 1479876,
  sha256: "04f61b72166394fdfb393dd589b0cb5a8b1b018820c73722278ddcdc2ffedc0f",
};
export const gaussianSamplePath = fileURLToPath(
  new URL("../../test-results/samples/guitar.compressed.ply", import.meta.url),
);
export async function downloadGaussianSample(destination = gaussianSamplePath) {
  const url = `https://raw.githubusercontent.com/playcanvas/engine/${gaussianSample.revision}/${gaussianSample.file}`;
  const provenance = () =>
    writeFile(
      destination + ".source.json",
      JSON.stringify(
        {
          ...gaussianSample,
          url,
          downloadedAt: new Date().toISOString(),
          note: "Public PlayCanvas engine test asset; downloaded locally for validation, not redistributed in this repository.",
        },
        null,
        2,
      ),
    );
  try {
    const cached = await readFile(destination);
    if (
      cached.length === gaussianSample.bytes &&
      gaussianSample.sha256 ===
        createHash("sha256").update(cached).digest("hex")
    ) {
      await provenance();
      return destination;
    }
  } catch {}
  let bytes;
  const sources = [
    [
      `https://api.github.com/repos/playcanvas/engine/contents/${gaussianSample.file}?ref=${gaussianSample.revision}`,
      { Accept: "application/vnd.github.raw+json" },
    ],
    [url, {}],
  ];
  let lastError;
  for (const [source, headers] of sources) {
    try {
      const response = await fetch(source, {
        headers,
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok)
        throw new Error(`Sample download failed: ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (
        bytes.length !== gaussianSample.bytes ||
        createHash("sha256").update(bytes).digest("hex") !==
          gaussianSample.sha256
      )
        throw new Error("Unexpected Gaussian sample checksum");
      break;
    } catch (e) {
      bytes = null;
      lastError = e;
    }
  }
  if (!bytes) throw lastError;
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  await provenance();
  return destination;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(await downloadGaussianSample(process.argv[2]));
