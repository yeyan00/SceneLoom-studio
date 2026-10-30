import React from "react";
import forestry from "./forestry/index.jsx";
// Built-in trusted UI plugins; install/remove at startup, no runtime hook injection.
import { createPluginRegistry } from "./registry.mjs";
export { createPluginRegistry } from "./registry.mjs";
export const studioPlugins = createPluginRegistry([forestry]);
export function StudioPlugins({ host, children }) {
  return studioPlugins.reduceRight((child, plugin) => {
    const Provider = plugin.Provider;
    return (
      <Provider
        key={plugin.id}
        host={{
          ...host,
          openPanel: () => host.openDock(plugin.id),
          activate: () => {
            host.runtime.current?.cancelActiveBrush?.();
            host.setTab(plugin.id);
            host.openDock(plugin.id);
          },
        }}
      >
        {child}
      </Provider>
    );
  }, children);
}
