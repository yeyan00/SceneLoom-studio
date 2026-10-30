import { validateBrush, matchesBrush } from "./brush.mjs";
const vector = (v, n) =>
  Array.isArray(v) && v.length === n && v.every(Number.isFinite);
export function validateRegion(region) {
  if (
    !region ||
    !vector(region.center, 3) ||
    !vector(region.half, 3) ||
    region.half.some((v) => v <= 0) ||
    !Number.isFinite(region.angle)
  )
    throw new Error("无效的局部区域");
}
export function inRegion(x, y, z, region) {
  if (!region) return true;
  const dx = x - region.center[0],
    dy = y - region.center[1],
    c = Math.cos(region.angle),
    s = Math.sin(region.angle);
  return (
    Math.abs(dx * c + dy * s) <= region.half[0] + 1e-7 &&
    Math.abs(-dx * s + dy * c) <= region.half[1] + 1e-7 &&
    Math.abs(z - region.center[2]) <= region.half[2] + 1e-7
  );
}
export function regionFromLine(a, b, width, zMin, zMax) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 1e-5 || width < 1e-5) throw new Error("截取范围太小");
  const region = {
    center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (zMin + zMax) / 2],
    half: [length / 2, width / 2, Math.max((zMax - zMin) / 2, 0.01)],
    angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
  };
  validateRegion(region);
  return region;
}
export function regionBounds(region) {
  const c = Math.abs(Math.cos(region.angle)),
    s = Math.abs(Math.sin(region.angle)),
    h = [
      c * region.half[0] + s * region.half[1],
      s * region.half[0] + c * region.half[1],
      region.half[2],
    ];
  return {
    min: region.center.map((v, i) => v - h[i]),
    max: region.center.map((v, i) => v + h[i]),
  };
}
export function validateSelection(expr, depth = 0, budget = { count: 0 }) {
  if (!expr || depth > 24 || ++budget.count > 128)
    throw new Error("选区过于复杂");
  if (expr.kind === "brush") {
    validateBrush(expr);
  } else if (expr.kind === "screen") {
    if (
      !vector(expr.matrix, 16) ||
      !Array.isArray(expr.polygon) ||
      expr.polygon.length < 3 ||
      expr.polygon.length > 2048 ||
      !expr.polygon.every((p) => vector(p, 2))
    )
      throw new Error("无效的选区");
    if (
      expr.depth &&
      (!vector(expr.depth, 2) ||
        expr.depth[0] >= expr.depth[1] ||
        expr.depth[0] < -1 ||
        expr.depth[1] > 1)
    )
      throw new Error("无效的深度范围");
  } else if (["union", "difference", "intersection"].includes(expr.kind)) {
    if (!Array.isArray(expr.children) || expr.children.length !== 2)
      throw new Error("无效的组合选区");
    expr.children.forEach((child) =>
      validateSelection(child, depth + 1, budget),
    );
  } else throw new Error("无效的选区");
}
export function combineSelection(previous, next, mode = "replace") {
  const result =
    !previous || mode === "replace"
      ? next
      : { kind: mode, children: [previous, next] };
  validateSelection(result);
  return result;
}
export function matchesSelection(x, y, z, expr, insidePolygon) {
  if (expr.kind === "brush") return matchesBrush(x, y, z, expr);
  if (expr.kind === "union")
    return (
      matchesSelection(x, y, z, expr.children[0], insidePolygon) ||
      matchesSelection(x, y, z, expr.children[1], insidePolygon)
    );
  if (expr.kind === "intersection")
    return (
      matchesSelection(x, y, z, expr.children[0], insidePolygon) &&
      matchesSelection(x, y, z, expr.children[1], insidePolygon)
    );
  if (expr.kind === "difference")
    return (
      matchesSelection(x, y, z, expr.children[0], insidePolygon) &&
      !matchesSelection(x, y, z, expr.children[1], insidePolygon)
    );
  const m = expr.matrix,
    w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w <= 0) return false;
  const px = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    py = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    pz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
  const [near, far] = expr.depth || [-1, 1];
  return pz >= near && pz <= far && insidePolygon(px, py, expr.polygon);
}
// A depth limit bounds the editable slab, including when the outline is inverted.
export function withinSelectionDepth(x, y, z, expr) {
  if (expr.kind === "union")
    return (
      withinSelectionDepth(x, y, z, expr.children[0]) ||
      withinSelectionDepth(x, y, z, expr.children[1])
    );
  if (expr.kind === "intersection")
    return (
      withinSelectionDepth(x, y, z, expr.children[0]) &&
      withinSelectionDepth(x, y, z, expr.children[1])
    );
  if (expr.kind === "difference")
    return withinSelectionDepth(x, y, z, expr.children[0]);
  if (!expr.depth) return true;
  const m = expr.matrix,
    w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w <= 0) return false;
  const depth = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
  return depth >= expr.depth[0] && depth <= expr.depth[1];
}
