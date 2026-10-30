import { validateSelection, validateRegion, inRegion } from "./selection.mjs";
import { chmCell, validateChmGrid } from "./chm.mjs";
export const TREE_FIELD = "forestry.treeID";
export const treeLimit = (type) =>
  type === "uint16" ? 65535 : type === "uint32" ? 4294967295 : 0;
export function treeColor(id) {
  if (!id) return "#88929f";
  const n = Math.imul(id, 2654435761) >>> 0;
  const h = n % 360,
    s = 0.64,
    l = 0.56;
  const a = s * Math.min(l, 1 - l);
  return (
    "#" +
    [0, 8, 4]
      .map((offset) => {
        const k = (offset + h / 30) % 12;
        return Math.round(
          255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))),
        )
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}
export function sourceTreeField(metadata) {
  const attr = metadata?.attributes?.find((a) => a.name === "treeID");
  if (!attr) return null;
  if (
    !treeLimit(attr.type) ||
    attr.numElements !== 1 ||
    attr.size !== (attr.type === "uint16" ? 2 : 4)
  )
    throw new Error("源 treeID 类型暂不支持");
  return {
    id: TREE_FIELD,
    name: "treeID",
    valueType: attr.type,
    defaultValue: 0,
    origin: "native",
  };
}
export function forestryState(operations, metadata) {
  let field = sourceTreeField(metadata);
  const trees = new Map();
  for (const op of operations) {
    if (op.type === "createTree" || op.type === "segmentTrees") {
      field ??= {
        id: TREE_FIELD,
        name: "treeID",
        valueType: op.valueType,
        defaultValue: 0,
        origin: "default",
      };
      for (const tree of op.type === "segmentTrees"
        ? op.trees
        : [{ id: op.treeId, name: op.name }])
        trees.set(tree.id, { ...tree, color: treeColor(tree.id) });
    } else if (op.type === "renameTree" && trees.has(op.treeId))
      trees.get(op.treeId).name = op.name;
  }
  return { field, trees: [...trees.values()] };
}
export function isForestOperation(op) {
  return ["createTree", "renameTree", "setAttribute", "segmentTrees"].includes(
    op?.type,
  );
}
export function validateForestOperation(op) {
  if (
    !op ||
    typeof op.id !== "string" ||
    !op.id ||
    op.id.length > 100 ||
    op.payloadVersion !== 2
  )
    throw new Error("无效的单木命令");
  if (op.type === "segmentTrees") {
    validateChmGrid(op.grid);
    if (
      !treeLimit(op.valueType) ||
      !Array.isArray(op.trees) ||
      !op.trees.length ||
      op.trees.length > 200000 ||
      !Number.isFinite(op.minHeight) ||
      op.minHeight < 0.5 ||
      !["unassigned", "replace"].includes(op.policy) ||
      op.selection ||
      !Array.isArray(op.excludeCategories) ||
      op.excludeCategories.length > 256 ||
      !op.excludeCategories.every(
        (c) => Number.isInteger(c) && c >= 0 && c <= 255,
      )
    )
      throw new Error("无效的 CHM 单木命令");
    const ids = new Set();
    for (const tree of op.trees) {
      if (
        !Number.isInteger(tree.id) ||
        tree.id < 1 ||
        tree.id > treeLimit(op.valueType) ||
        ids.has(tree.id) ||
        typeof tree.name !== "string" ||
        !tree.name.trim() ||
        tree.name.length > 120
      )
        throw new Error("无效的 CHM 单木编号");
      ids.add(tree.id);
    }
    if (
      op.grid.labels.some(
        (id, i) => id && (!ids.has(id) || op.grid.ground[i] === null),
      )
    )
      throw new Error("CHM 栅格包含未定义单木");
    if (op.scope) validateRegion(op.scope);
    return;
  }
  if (op.type === "createTree" || op.type === "renameTree") {
    if (
      !Number.isInteger(op.treeId) ||
      op.treeId < 1 ||
      op.treeId > 4294967295 ||
      typeof op.name !== "string" ||
      !op.name.trim() ||
      op.name.length > 120
    )
      throw new Error("无效的单木定义");
    if (
      op.type === "createTree" &&
      (!treeLimit(op.valueType) || op.treeId > treeLimit(op.valueType))
    )
      throw new Error("单木编号超出字段范围");
  }
  if (
    op.type === "setAttribute" &&
    (op.fieldId !== TREE_FIELD ||
      !Number.isInteger(op.value) ||
      op.value < 0 ||
      op.value > 4294967295)
  )
    throw new Error("无效的单木属性值");
  if (op.selection) {
    validateSelection(op.selection);
    if (op.scope) validateRegion(op.scope);
    if (
      typeof op.invert !== "boolean" ||
      !["unassigned", "replace", "remove"].includes(op.policy)
    )
      throw new Error("无效的单木归属策略");
  }
  if (
    op.type === "setAttribute" &&
    (!op.selection ||
      !Number.isInteger(op.treeId) ||
      op.treeId < 1 ||
      op.treeId > 4294967295 ||
      (op.policy === "remove" ? op.value !== 0 : op.value !== op.treeId))
  )
    throw new Error("无效的单木归属策略");
  if (op.type === "renameTree" && op.selection)
    throw new Error("无效的单木命令");
  if (op.type === "createTree" && op.selection && op.policy === "remove")
    throw new Error("无效的单木归属策略");
}
export function validateForestHistory(operations, metadata) {
  if (!operations.some(isForestOperation)) return;
  let field = sourceTreeField(metadata);
  const trees = new Set();
  for (const op of operations) {
    if (!isForestOperation(op)) continue;
    validateForestOperation(op);
    if (op.type === "createTree" || op.type === "segmentTrees") {
      const ids =
        op.type === "segmentTrees" ? op.trees.map((t) => t.id) : [op.treeId];
      if (
        ids.some((id) => trees.has(id)) ||
        (field && field.valueType !== op.valueType)
      )
        throw new Error("单木编号或字段类型冲突");
      field ??= { valueType: op.valueType };
      ids.forEach((id) => trees.add(id));
    } else if (!trees.has(op.treeId)) throw new Error("请先创建或选择单木");
    if (op.type === "setAttribute" && op.value > treeLimit(field?.valueType))
      throw new Error("单木编号超出字段范围");
  }
}
export function pointTreeValue(current, op, x, y, z, hit, category) {
  if (op.type === "segmentTrees") {
    if (op.excludeCategories.includes(category)) return current;
    if (op.policy === "unassigned" && current !== 0) return current;
    if (!inRegion(x, y, z, op.scope)) return current;
    const i = chmCell(op.grid, x, y);
    if (
      i < 0 ||
      !op.grid.labels[i] ||
      op.grid.ground[i] === null ||
      z - op.grid.ground[i] < op.minHeight
    )
      return current;
    return op.grid.labels[i];
  }
  if (
    (op.type === "createTree" && op.selection) ||
    op.type === "setAttribute"
  ) {
    if (op.policy === "unassigned" && current !== 0) return current;
    if (op.policy === "remove" && current !== op.treeId) return current;
    if (hit(x, y, z, op))
      return op.type === "createTree" ? op.treeId : op.value;
  }
  return current;
}
