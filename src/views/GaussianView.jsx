import React, { useEffect, useRef, useState } from "react";
import { api, activity } from "../api.js";

// The engine is lazy loaded: opening point clouds does not initialize PlayCanvas.
export function GaussianView({ resource, active, t, locale, onState }) {
  const host = useRef();
  const engine = useRef();
  const current = useRef();
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState(resource.view);
  const [metrics, setMetrics] = useState({});
  const [scenePanelOpen, setScenePanelOpen] = useState(false);
  current.current = { active, onState, view };
  useEffect(() => {
    let cancelled = false;
    let runtime;
    const saveState = (next) => {
      if (cancelled) return;
      setView(next);
      api(`/splats/${resource.id}/view-state`, next).catch((e) => {
        if (!cancelled) setError(e.message);
      });
    };
    setStatus("loading");
    setError("");
    import("./gaussian-runtime.js")
      .then(async ({ GaussianRuntime }) => {
        if (cancelled) return;
        runtime = new GaussianRuntime(
          host.current,
          { ...resource, view: current.current.view },
          {
            onStats: (value) => {
              if (!cancelled) {
                setMetrics(value);
                current.current.onState?.(value);
              }
            },
            onView: saveState,
            locale,
          },
        );
        engine.current = runtime;
        runtime.setActive(current.current.active);
        await runtime.open();
        if (!cancelled) {
          setStatus("ready");
          activity("3DGS loaded", "info", {
            name: resource.name,
            count: resource.count,
            loadMs: runtime.loadMs,
          });
        }
      })
      .catch((e) => {
        runtime?.dispose();
        if (engine.current === runtime) engine.current = null;
        if (!cancelled) {
          setStatus("error");
          setError(e.message);
          activity("3DGS load failed", "error", {
            name: resource.name,
            error: e.message,
          });
        }
      });
    return () => {
      cancelled = true;
      runtime?.dispose();
      engine.current = null;
    };
  }, [resource.id, attempt]);
  useEffect(() => {
    engine.current?.setActive(active);
  }, [active]);
  useEffect(() => {
    engine.current?.setLocale(locale);
  }, [locale]);
  const [format, setFormat] = useState("ply");
  async function command(fn) {
    try {
      await fn(engine.current);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <div className="gaussian-workspace" data-testid="gaussian-workspace">
      <div className="workspace-tools gaussian-tools">
        <button
          disabled={status !== "ready"}
          onClick={() => command((e) => e.fit())}
        >
          {t("适应视图")}
        </button>
        <button
          disabled={status !== "ready"}
          onClick={() => command((e) => e.saveProject())}
        >
          {t("保存 GS 工程")}
        </button>
        <label>
          {t("打开 GS 工程")}
          <input
            aria-label="Open GS project"
            type="file"
            accept=".ssproj"
            disabled={status !== "ready"}
            onChange={(e) => {
              const file = e.target.files[0];
              if (file) command((r) => r.loadProject(file));
              e.target.value = "";
            }}
          />
        </label>
        <select
          aria-label="GS export format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
        >
          {["ply", "splat", "sog", "spz"].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <button
          disabled={status !== "ready"}
          onClick={() => command((e) => e.export(format))}
        >
          {t("导出 GS")}
        </button>
        {["gaussians", "centers", "rings"].map((key, i) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={!!metrics.display?.[key]}
              disabled={status !== "ready"}
              onChange={(e) =>
                command((r) => r.setDisplay(key, e.target.checked))
              }
            />
            {t(["高斯", "点中心", "椭球轮廓"][i])}
          </label>
        ))}
        <button
          aria-pressed={scenePanelOpen}
          onClick={() => setScenePanelOpen((open) => !open)}
        >
          {t("GS 场景面板")}
        </button>
        <span className="gaussian-count">
          {(metrics.count || resource.count || 0).toLocaleString()} Gaussians
        </span>
      </div>
      <div
        className="gaussian-viewport"
        data-scene-panel={scenePanelOpen}
        ref={host}
        data-testid="gaussian-viewport"
      >
        {status === "loading" && (
          <div className="render-message" role="status">
            {t("正在加载 3DGS…")}
          </div>
        )}
        {error && (
          <div className="render-message" role="alert">
            <p>{t(error)}</p>
            <button
              onClick={() =>
                status === "error" ? setAttempt((n) => n + 1) : setError("")
              }
            >
              {t(status === "error" ? "重新加载" : "关闭")}
            </button>
          </div>
        )}
      </div>
      <div className="gaussian-status" data-testid="gaussian-status">
        <span>
          {resource.encoding} · {(resource.bytes / 1048576).toFixed(1)} MB
        </span>
        <span>
          {metrics.loadMs
            ? `${t("加载")} ${(metrics.loadMs / 1000).toFixed(2)} s`
            : t("等待首帧")}
        </span>
      </div>
    </div>
  );
}
