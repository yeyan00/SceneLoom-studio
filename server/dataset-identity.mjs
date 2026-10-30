import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
export const pointFiles = ["metadata.json", "hierarchy.bin", "octree.bin"];
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export async function datasetIdentity(folder, expected) {
  const metadataText = await readFile(
      path.join(folder, "metadata.json"),
      "utf8",
    ),
    metadata = JSON.parse(metadataText);
  const stats = await Promise.all(
    pointFiles.slice(1).map((name) => stat(path.join(folder, name))),
  );
  const calculated = digest(
    metadataText + stats.map((s) => `${s.size}:${s.mtimeMs}`).join("|"),
  );
  if (expected?.fingerprint) {
    if (expected.fingerprint.metadataHash !== digest(metadataText))
      throw new Error("工程数据源版本不匹配，请重新关联数据");
    for (const [i, name] of pointFiles.slice(1).entries()) {
      const original = expected.fingerprint.files?.[name],
        current = stats[i];
      if (!original || current.size !== original.size)
        throw new Error("工程数据源版本不匹配，请重新关联数据");
      if (
        current.mtimeMs !== original.mtimeMs &&
        (!original.sha256 ||
          (await hashFile(path.join(folder, name))) !== original.sha256)
      )
        throw new Error("工程数据源版本不匹配，请重新关联数据");
    }
  } else if (expected && expected.sourceRevision !== calculated)
    throw new Error("工程数据源版本不匹配，请重新关联数据");
  return {
    metadataText,
    metadata,
    stats,
    revision: expected?.sourceRevision || calculated,
  };
}
