import React from "react";
import { X } from "lucide-react";

export function DockTabs({ entries, active, onSelect, onClose, t }) {
  const selected = entries.find((entry) => entry.id === active);
  return (
    <div className="dock-tabs" role="tablist" aria-label={t("侧边面板")}>
      <div className="dock-tab-scroll">
        {entries.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            id={`dock-${id}`}
            aria-controls={`pane-${id}`}
            aria-selected={active === id}
            onClick={() => onSelect(id)}
          >
            {Icon && <Icon size={14} />}
            {t(label)}
          </button>
        ))}
      </div>
      {selected && (
        <button
          className="dock-close"
          title={t("关闭{0}面板", { 0: t(selected.label) })}
          aria-label={t("关闭{0}面板", { 0: t(selected.label) })}
          onClick={() => onClose(active)}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
