import React, { useEffect, useRef, useState } from "react";
import { api, activity } from "../api.js";

export function TilesView({ resource, active, t, onState }) {
  const host = useRef(),
    runtime = useRef(),
    current = useRef();
  current.current = { active, onState };
  const [stats, setStats] = useState({}),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [wireframe, setWireframe] = useState(false);
  const [quality, setQuality] = useState(8);
  useEffect(() => {
    let cancelled = false,
      engine;
    setError("");
    setStats({});
    import("./tiles-runtime.js")
      .then(({ TilesRuntime }) => {
        if (cancelled) return;
        engine = new TilesRuntime(host.current, resource, {
          onStats: (data) => {
            if (!cancelled) {
              setStats(data);
              current.current.onState?.(data);
            }
          },
          onError: (message) => {
            if (!cancelled) {
              setError(message);
              if (message)
                activity("3D Tiles load failed", "error", { message });
            }
          },
          onView: (view) =>
            api(`/tiles/${resource.id}/view-state`, view).catch((e) => {
              if (!cancelled) setError(e.message);
            }),
        });
        runtime.current = engine;
        engine.setActive(current.current.active);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
      engine?.dispose();
      runtime.current = null;
    };
  }, [resource.id, attempt]);
  useEffect(() => {
    runtime.current?.setActive(active);
  }, [active]);
  useEffect(() => {
    runtime.current?.setWireframe(wireframe);
  }, [wireframe, stats.ready]);
  useEffect(() => {
    runtime.current?.setQuality(quality);
  }, [quality, stats.ready]);
  return (
    <div className="gaussian-workspace" data-testid="tiles-workspace">
      <div className="workspace-tools gaussian-tools">
        <label>
          {t("LOD 精度")}
          <select
            aria-label={t("LOD 精度")}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
          >
            {[2, 4, 8, 16, 32].map((value) => (
              <option key={value} value={value}>
                {value} px
              </option>
            ))}
          </select>
        </label>
        <button disabled={!stats.ready} onClick={() => runtime.current?.fit()}>
          {t("适应视图")}
        </button>
        <label>
          <input
            type="checkbox"
            checked={wireframe}
            onChange={(e) => setWireframe(e.target.checked)}
          />
          {t("线框")}
        </label>
        <span className="gaussian-count">
          {resource.encoding} · {t("已加载瓦片")} {stats.loaded || 0} ·{" "}
          {t("可见瓦片")} {stats.visible || 0}
        </span>
      </div>
      <div className="tiles-viewport" ref={host} data-testid="tiles-viewport">
        {!stats.ready && !error && (
          <div className="render-message" role="status">
            {t("正在加载 3D Tiles…")}
          </div>
        )}
        {error && (
          <div className="render-message" role="alert">
            <p>{t(error)}</p>
            <button onClick={() => setAttempt((n) => n + 1)}>
              {t("重新加载")}
            </button>
          </div>
        )}
      </div>
      <div className="gaussian-status">
        <span>{t("左键旋转 · 右键平移 · 滚轮缩放")}</span>
        <span>
          {stats.loadMs
            ? `${t("加载")} ${(stats.loadMs / 1000).toFixed(2)} s`
            : ""}
        </span>
      </div>
    </div>
  );
}
