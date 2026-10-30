import { promises as fs } from "node:fs";
import path from "node:path";
export function validateTool(raw) {
  if (
    !raw ||
    typeof raw.id !== "string" ||
    !/^[-\w.]+$/.test(raw.id) ||
    typeof raw.title !== "string" ||
    !raw.title ||
    !Array.isArray(raw.category) ||
    raw.category.length < 1 ||
    raw.category.length > 2 ||
    !raw.category.every(
      (s) => typeof s === "string" && s.length > 0 && s.length <= 60,
    ) ||
    typeof raw.executable !== "string" ||
    !raw.executable ||
    !Array.isArray(raw.args) ||
    !raw.args.every((a) => typeof a === "string")
  )
    throw new Error("Invalid tool manifest: max tree depth is 3");
  const params = raw.parameters || [];
  if (
    !Array.isArray(params) ||
    params.length > 32 ||
    params.some(
      (p) =>
        !/^\w+$/.test(p.id) ||
        typeof p.label !== "string" ||
        !["text", "number", "file", "directory"].includes(p.type),
    )
  )
    throw new Error("Invalid tool parameters");
  if (new Set(params.map((p) => p.id)).size !== params.length)
    throw new Error("Duplicate tool parameter");
  for (const arg of raw.args)
    for (const match of arg.matchAll(/\{(\w+)\}/g))
      if (!params.some((p) => p.id === match[1]))
        throw new Error("Unknown tool parameter: " + match[1]);
  return { ...raw, parameters: params };
}
export function toolArguments(tool, values) {
  const mapped = {};
  for (const p of tool.parameters) {
    const value = values[p.id] ?? p.default ?? "";
    if (p.required && String(value).trim() === "")
      throw new Error("Required parameter: " + p.label);
    if (
      p.type === "number" &&
      (String(value).trim() === "" || !Number.isFinite(Number(value)))
    )
      throw new Error("Invalid number: " + p.label);
    if (String(value).length > 8192) throw new Error("Parameter too long");
    mapped[p.id] = String(value);
  }
  return tool.args.map((arg) =>
    arg.replace(/\{(\w+)\}/g, (_, id) => mapped[id]),
  );
}
export async function loadTools(directory, logger) {
  await fs.mkdir(directory, { recursive: true });
  const tools = new Map();
  for (const name of (await fs.readdir(directory))
    .filter((n) => n.endsWith(".json"))
    .sort())
    try {
      const tool = validateTool(
        JSON.parse(await fs.readFile(path.join(directory, name), "utf8")),
      );
      if (tool.id.startsWith("builtin.") || tools.has(tool.id))
        throw new Error("Duplicate/reserved tool ID");
      tool.executable = path.isAbsolute(tool.executable)
        ? tool.executable
        : path.resolve(directory, tool.executable);
      tools.set(tool.id, tool);
      logger.write("info", "tools", "Tool registered", { toolId: tool.id });
    } catch (e) {
      logger.write("error", "tools", "Tool registration failed", {
        manifest: name,
        error: e.message,
      });
    }
  return tools;
}
export function describeTool(tool) {
  const { executable, args, ...description } = tool;
  return { ...description, kind: "executable" };
}
