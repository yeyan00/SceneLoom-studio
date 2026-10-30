import { api } from "../api.js";
import React from "react";
export function ToolDialog({ tool, t, onStarted, onError, busy, setBusy }) {
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const parameters = Object.fromEntries(new FormData(e.target));
        setBusy(true);
        try {
          onStarted(await api(`/tools/${tool.id}/run`, { parameters }));
        } catch (error) {
          onError(error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>{t(tool.description || "工具在独立进程中执行，输出记录到日志。")}</p>
      {tool.parameters.map((p) => (
        <label key={p.id}>
          {t(p.label)}
          <input
            aria-label={t(p.label)}
            name={p.id}
            type={p.type === "number" ? "number" : "text"}
            step="any"
            required={!!p.required}
            defaultValue={p.default ?? ""}
          />
        </label>
      ))}
      <div className="modal-actions">
        <button type="submit" className="primary" disabled={busy}>
          {t(busy ? "检查中…" : "运行工具")}
        </button>
      </div>
    </form>
  );
}
