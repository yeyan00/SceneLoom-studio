import path from "node:path";
import { readFile, stat } from "node:fs/promises";

export function validateCollection(value) {
  if (
    value?.format !== "SceneLoom" ||
    value.version !== 2 ||
    !Array.isArray(value.resources) ||
    value.resources.length > 100
  )
    throw new Error("无效的多数据项目文件");
  for (const resource of value.resources) {
    if (
      !resource ||
      !["pointcloud", "gaussian", "tiles"].includes(resource.type) ||
      typeof resource.path !== "string" ||
      !resource.path.trim() ||
      resource.path.includes("\0")
    )
      throw new Error("无效的项目数据引用");
  }
  return value;
}

export async function readCollection(file) {
  if ((await stat(file)).size > 1024 * 1024) throw new Error("项目文件过大");
  return validateCollection(JSON.parse(await readFile(file, "utf8")));
}

export function collectionForFile(file, resources) {
  const value = validateCollection({
    format: "SceneLoom",
    version: 2,
    resources,
  });
  const seen = new Set();
  return {
    ...value,
    resources: value.resources.flatMap((resource) => {
      if (!path.isAbsolute(resource.path))
        throw new Error("请选择有效的绝对数据路径");
      const key = `${resource.type}:${path.resolve(resource.path)}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          type: resource.type,
          path: path.relative(path.dirname(file), resource.path) || ".",
        },
      ];
    }),
  };
}
