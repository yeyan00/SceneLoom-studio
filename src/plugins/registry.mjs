export function createPluginRegistry(plugins) {
  const ids = new Set(["project", "edit", "render", "tools", "properties"]),
    modes = new Set(["rgb", "height", "classification"]);
  return Object.freeze(
    plugins.map((p) => {
      if (
        !p ||
        !/^[a-z][a-z0-9-]*$/.test(p.id) ||
        ids.has(p.id) ||
        typeof p.label !== "string" ||
        typeof p.Provider !== "function" ||
        typeof p.Ribbon !== "function" ||
        typeof p.Panel !== "function"
      )
        throw new Error("Invalid studio plugin");
      ids.add(p.id);
      for (const mode of p.displayModes || []) {
        if (!mode.id || !mode.label || modes.has(mode.id))
          throw new Error("Duplicate display mode");
        modes.add(mode.id);
      }
      return Object.freeze({
        ...p,
        displayModes: Object.freeze([...(p.displayModes || [])]),
      });
    }),
  );
}
