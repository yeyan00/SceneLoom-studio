// Portable CHM result: coordinates use the same dataset-local frame as edits.
export const MAX_CHM_CELLS = 200000;
export function chmCell(grid, x, y) {
  const col = Math.floor((x - grid.origin[0]) / grid.resolution);
  const row = Math.floor((y - grid.origin[1]) / grid.resolution);
  return col < 0 || row < 0 || col >= grid.width || row >= grid.height
    ? -1
    : row * grid.width + col;
}
export function validateChmGrid(grid) {
  const n = grid?.width * grid?.height;
  if (
    !grid ||
    !Number.isInteger(grid.width) ||
    !Number.isInteger(grid.height) ||
    grid.width < 1 ||
    grid.height < 1 ||
    n > MAX_CHM_CELLS ||
    !Array.isArray(grid.origin) ||
    grid.origin.length !== 2 ||
    !grid.origin.every(Number.isFinite) ||
    !Number.isFinite(grid.resolution) ||
    grid.resolution < 0.1 ||
    !Array.isArray(grid.ground) ||
    !Array.isArray(grid.labels) ||
    grid.ground.length !== n ||
    grid.labels.length !== n ||
    !grid.ground.every((v) => v === null || Number.isFinite(v)) ||
    !grid.labels.every((v) => Number.isInteger(v) && v >= 0 && v <= 4294967295)
  )
    throw new Error("无效的 CHM 结果");
}
