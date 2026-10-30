// Pixel-space swept disks. The same predicate is used for live and cold replay.
export const MAX_BRUSH_SAMPLES = 4096;
const grids = new WeakMap();
export function validateBrush(expr) {
  if (
    expr.version !== 1 ||
    !Array.isArray(expr.viewport) ||
    expr.viewport.length !== 2 ||
    !expr.viewport.every((v) => Number.isFinite(v) && v > 0 && v <= 32768) ||
    !Array.isArray(expr.matrix) ||
    expr.matrix.length !== 16 ||
    !expr.matrix.every(Number.isFinite) ||
    !Array.isArray(expr.samples) ||
    !expr.samples.length ||
    expr.samples.length > MAX_BRUSH_SAMPLES ||
    !expr.samples.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 3 &&
        p.every(Number.isFinite) &&
        p[2] >= 2 &&
        p[2] <= 256 &&
        p[0] >= -512 &&
        p[0] <= expr.viewport[0] + 512 &&
        p[1] >= -512 &&
        p[1] <= expr.viewport[1] + 512,
    )
  )
    throw new Error("无效的画刷轨迹");
}
function swept(x, y, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    dr = b[2] - a[2],
    px = x - a[0],
    py = y - a[1];
  const A = dx * dx + dy * dy - dr * dr,
    B = -2 * (px * dx + py * dy + a[2] * dr),
    C = px * px + py * py - a[2] * a[2];
  const t = A > 0 ? Math.max(0, Math.min(1, -B / (2 * A))) : 0;
  return Math.min(C, A + B + C, A * t * t + B * t + C) <= 1e-7;
}
function grid(expr) {
  let cached = grids.get(expr);
  if (cached) return cached;
  const records = expr.samples.map((b, i) => {
    const a = expr.samples[Math.max(0, i - 1)],
      r = Math.max(a[2], b[2]);
    return {
      i,
      minX: Math.min(a[0], b[0]) - r,
      maxX: Math.max(a[0], b[0]) + r,
      minY: Math.min(a[1], b[1]) - r,
      maxY: Math.max(a[1], b[1]) + r,
    };
  });
  function build(items) {
    const bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    };
    for (const item of items) {
      bounds.minX = Math.min(bounds.minX, item.minX);
      bounds.minY = Math.min(bounds.minY, item.minY);
      bounds.maxX = Math.max(bounds.maxX, item.maxX);
      bounds.maxY = Math.max(bounds.maxY, item.maxY);
    }
    if (items.length <= 8) return { ...bounds, items };
    const axis =
      bounds.maxX - bounds.minX > bounds.maxY - bounds.minY ? "minX" : "minY";
    items.sort((a, b) => a[axis] - b[axis]);
    const mid = Math.floor(items.length / 2);
    return {
      ...bounds,
      left: build(items.slice(0, mid)),
      right: build(items.slice(mid)),
    };
  }
  cached = build(records);
  grids.set(expr, cached);
  return cached;
}
export function matchesBrush(x, y, z, expr) {
  const m = expr.matrix,
    w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w <= 0) return false;
  const depth = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
  if (depth < -1 || depth > 1) return false;
  const px =
    (((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * expr.viewport[0]) / 2;
  const py =
    ((1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * expr.viewport[1]) / 2;
  const stack = [grid(expr)];
  while (stack.length) {
    const node = stack.pop();
    if (px < node.minX || px > node.maxX || py < node.minY || py > node.maxY)
      continue;
    if (node.items) {
      for (const { i } of node.items)
        if (swept(px, py, expr.samples[Math.max(0, i - 1)], expr.samples[i]))
          return true;
    } else stack.push(node.left, node.right);
  }
  return false;
}
