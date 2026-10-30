import React, { createContext, useContext } from "react";
export const EditAdapterContext = createContext(null);
export const useEditAdapter = () => useContext(EditAdapterContext);
export function ExtensionWorkspace({ component: Workspace, ...props }) {
  const adapter = useEditAdapter();
  return (
    <Workspace
      {...props}
      brushAction={adapter?.brushAction}
      brushLabel={adapter?.brushLabel}
      onBrushStart={adapter?.onBrushStart || props.onBrushStart}
      classColor={adapter?.color || props.classColor}
    />
  );
}
