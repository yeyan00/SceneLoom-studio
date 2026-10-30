import { validateRegion } from "./selection.mjs";
export function validateWorkspace(workspace) {
  if (workspace === undefined) return;
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace))
    throw new Error("无效的视图状态");
  if (workspace.region) validateRegion(workspace.region);
  const roles = ["main", "top", "front", "side"];
  if (workspace.maximized != null && !roles.includes(workspace.maximized))
    throw new Error("无效的视图状态");
  if (workspace.single !== undefined && typeof workspace.single !== "boolean")
    throw new Error("无效的视图状态");
  if (workspace.cameras) {
    if (
      typeof workspace.cameras !== "object" ||
      Array.isArray(workspace.cameras) ||
      Object.keys(workspace.cameras).some((key) => !roles.includes(key))
    )
      throw new Error("无效的视图状态");
    for (const state of Object.values(workspace.cameras)) {
      if (
        !state ||
        ![state.position, state.target, state.up].every(
          (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite),
        ) ||
        !(state.zoom > 0 && state.zoom < 1e8) ||
        typeof state.locked !== "boolean" ||
        (state.height != null &&
          !(state.height > 0 && Number.isFinite(state.height)))
      )
        throw new Error("无效的视图状态");
    }
  }
}
