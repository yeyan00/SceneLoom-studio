import {
  inRegion,
  validateRegion,
  validateSelection,
  matchesSelection,
  withinSelectionDepth,
} from "./selection.mjs";
import { isForestOperation, validateForestOperation } from "./forestry.mjs";
export const palette = [
  "#b7c6d6",
  "#b7c6d6",
  "#cbb08b",
  "#a5cd68",
  "#53ad79",
  "#24764c",
  "#dfb6a1",
  "#eb7274",
  "#8cbfdf",
];
export function validateOperation(op) {
  if (isForestOperation(op)) {
    validateForestOperation(op);
    return;
  }
  if (op?.selection) {
    if (
      !["classify", "delete"].includes(op.type) ||
      typeof op.invert !== "boolean"
    )
      throw new Error("无效的编辑规则");
    validateSelection(op.selection);
    if (op.scope) validateRegion(op.scope);
    if (
      op.type === "classify" &&
      (!Number.isInteger(op.category) || op.category < 0 || op.category > 255)
    )
      throw new Error("类别必须在 0–255 之间");
    return;
  }
  if (
    !op ||
    !["classify", "delete"].includes(op.type) ||
    !Array.isArray(op.matrix) ||
    op.matrix.length !== 16 ||
    !op.matrix.every(Number.isFinite) ||
    !Array.isArray(op.polygon) ||
    op.polygon.length < 3 ||
    op.polygon.length > 2048 ||
    !op.polygon.every((p) => p.length === 2 && p.every(Number.isFinite)) ||
    ![true, false].includes(op.invert)
  )
    throw new Error("无效的编辑规则");
  if (
    op.type === "classify" &&
    (!Number.isInteger(op.category) || op.category < 0 || op.category > 255)
  )
    throw new Error("类别必须在 0–255 之间");
}
export function insidePolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i],
      [bx, by] = polygon[j];
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (
      Math.abs(cross) < 1e-10 &&
      x >= Math.min(ax, bx) - 1e-10 &&
      x <= Math.max(ax, bx) + 1e-10 &&
      y >= Math.min(ay, by) - 1e-10 &&
      y <= Math.max(ay, by) + 1e-10
    )
      return true;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  return inside;
}
export function selected(x, y, z, op) {
  if (op.selection) {
    if (!inRegion(x, y, z, op.scope)) return false;
    if (op.invert && !withinSelectionDepth(x, y, z, op.selection)) return false;
    const hit = matchesSelection(x, y, z, op.selection, insidePolygon);
    return op.invert ? !hit : hit;
  }
  const m = op.matrix,
    w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w <= 0) return op.invert;
  const px = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    py = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    pz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
  const hit = pz >= -1 && pz <= 1 && insidePolygon(px, py, op.polygon);
  return op.invert ? !hit : hit;
}
export function evaluatePoint(x, y, z, category, operations) {
  let deleted = false;
  for (const op of operations)
    if (
      ["classify", "delete"].includes(op.type) &&
      !deleted &&
      selected(x, y, z, op)
    ) {
      if (op.type === "delete") deleted = true;
      else category = op.category;
    }
  return { category, deleted };
}
