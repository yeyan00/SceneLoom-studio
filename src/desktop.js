import { isTauri } from "@tauri-apps/api/core";
import { dataFilters } from "../shared/data-types.mjs";

export const desktop = isTauri();
export async function pickLocalData(
  directory = false,
  type = "auto",
  t = (value) => value,
) {
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open({
    directory,
    multiple: false,
    title: directory ? "Open data directory" : "Open spatial data",
    ...(!directory
      ? {
          filters: dataFilters(type, t),
        }
      : {}),
  });
}

export async function pickProjectDestination() {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({
    defaultPath: "workspace.sceneloom.json",
    filters: dataFilters("project"),
  });
}
