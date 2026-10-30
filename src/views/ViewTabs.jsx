import React from "react";
import { BoxSelect, Sparkles, X } from "lucide-react";

// View descriptors carry no engine objects. Future DOM / 3D Tiles views can use
// this host without sharing a graphics context or inheriting point edit tools.
export function ViewTabs({ entries, activeId, onActivate, onClose, t }) {
  return (
    <div className="scene-view-tabs" role="tablist" aria-label={t("数据视图")}>
      {entries.map((entry, i) => (
        <div className="scene-tab" key={entry.id}>
          <button
            role="tab"
            id={`view-tab-${entry.id}`}
            aria-controls={`view-pane-${entry.id}`}
            aria-selected={activeId === entry.id}
            tabIndex={activeId === entry.id ? 0 : -1}
            title={entry.name}
            onClick={() => onActivate(entry.id)}
            onKeyDown={(e) => {
              const target =
                e.key === "ArrowRight"
                  ? (i + 1) % entries.length
                  : e.key === "ArrowLeft"
                    ? (i + entries.length - 1) % entries.length
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? entries.length - 1
                        : -1;
              if (target >= 0) {
                e.preventDefault();
                onActivate(entries[target].id);
                document
                  .getElementById(`view-tab-${entries[target].id}`)
                  ?.focus();
              }
            }}
          >
            {entry.type === "gaussian" ? (
              <Sparkles size={14} />
            ) : (
              <BoxSelect size={14} />
            )}
            <span>{entry.name}</span>
            <small>
              {entry.type === "gaussian"
                ? "3DGS"
                : entry.type === "tiles"
                  ? "3D Tiles"
                  : "3D"}
            </small>
          </button>
          {entry.closable && (
            <button
              className="close-view"
              aria-label={t("关闭视图 {0}", { 0: entry.name })}
              onClick={() => onClose(entry.id)}
            >
              <X size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
