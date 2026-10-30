import React, { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { treeColor } from "../../../shared/forestry.mjs";

const signature = (h) =>
  JSON.stringify([
    h.dataset?.id,
    h.operations.slice(0, h.cursor).map((op) => op.id),
    h.workspace.region || null,
    h.labelSet || null,
  ]);
export function useChm(host, field, valueType, policy) {
  const [open, setOpen] = useState(false),
    [job, setJob] = useState(null),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [params, setParams] = useState({
      resolution: 0.5,
      terrainResolution: 2,
      minHeight: 2,
      seedDistance: 3,
      minCrownArea: 1,
      groundWindow: 8,
      groundMode: "auto",
      tileSize: 64,
      overlap: 12,
    });
  const live = useRef(host);
  live.current = host;
  const task = useRef(null),
    snapshot = useRef("");
  const key =
    signature(host) +
    JSON.stringify([params, policy, field?.valueType || valueType]);
  const liveKey = useRef(key);
  liveKey.current = key;
  useEffect(
    () => () => {
      const old = task.current;
      task.current = null;
      if (old?.route) api(old.route + "/cancel", {}).catch(() => {});
    },
    [host.dataset?.id],
  );
  useEffect(() => {
    setJob(null);
    setResult(null);
    setError("");
    setBusy(false);
  }, [host.dataset?.id]);
  async function start() {
    if (!host.dataset || busy || job?.status === "running") return;
    host.activate();
    host.setTool("navigate");
    host.runtime.current?.cancelActiveBrush?.();
    setBusy(true);
    setError("");
    setResult(null);
    snapshot.current = key;
    const owner = host.dataset.id,
      marker = { route: null };
    task.current = marker;
    try {
      const created = await api(`/datasets/${owner}/chm`, {
        operations: host.operations.slice(0, host.cursor),
        scope: host.workspace.region || null,
        parameters: params,
        valueType: field?.valueType || valueType,
        policy,
        labelSet: host.labelSet,
      });
      marker.route = `/datasets/${owner}/chm/${created.id}`;
      if (task.current !== marker) {
        await api(marker.route + "/cancel", {});
        return;
      }
      setJob(created);
      setBusy(false);
      while (task.current === marker) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (task.current !== marker) return;
        const next = await api(marker.route);
        if (task.current !== marker) return;
        setJob(next);
        if (next.status !== "running") {
          if (next.status === "succeeded") {
            const detail = await api(marker.route + "/result");
            if (task.current === marker) setResult(detail);
          } else if (next.error) setError(next.error);
          return;
        }
      }
    } catch (e) {
      if (task.current === marker) {
        setError(e.message);
        setJob(null);
      }
    } finally {
      if (task.current === marker) setBusy(false);
    }
  }
  async function cancel() {
    const current = task.current;
    if (!current?.route) return;
    try {
      const next = await api(current.route + "/cancel", {});
      if (task.current === current) setJob(next);
    } catch (e) {
      setError(e.message);
    }
  }
  async function apply() {
    const current = task.current;
    if (!result || busy || liveKey.current !== snapshot.current) return;
    setBusy(true);
    setError("");
    try {
      const { command } = await api(current.route + "/apply", {});
      if (task.current !== current) return;
      if (liveKey.current !== snapshot.current)
        throw new Error("编辑或区域已改变，请重新计算");
      live.current.runtime.current?.cancelActiveBrush?.();
      live.current.history.commit(command);
      live.current.setMode("tree");
      setResult(null);
      setJob(null);
      task.current = null;
    } catch (e) {
      if (task.current === current) setError(e.message);
    } finally {
      if (task.current === current || task.current === null) setBusy(false);
    }
  }
  return {
    open,
    setOpen,
    job,
    result,
    busy,
    error,
    params,
    setParams,
    start,
    cancel,
    apply,
    stale: !!result && key !== snapshot.current,
  };
}

function Preview({ data, t }) {
  const canvas = useRef(null);
  useEffect(() => {
    if (!data) return;
    const { grid, heights } = data,
      c = canvas.current;
    c.width = grid.width;
    c.height = grid.height;
    const ctx = c.getContext("2d"),
      pixels = ctx.createImageData(c.width, c.height),
      colors = new Map();
    for (let i = 0; i < grid.labels.length; i++) {
      const id = grid.labels[i];
      let rgb;
      if (id) {
        if (!colors.has(id)) {
          const hex = treeColor(id);
          colors.set(
            id,
            [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)),
          );
        }
        rgb = colors.get(id);
      } else rgb = heights[i] === null ? [22, 30, 40] : [70, 79, 87];
      // Raster origin is lower-left, canvas origin is upper-left.
      const at =
        ((grid.height - 1 - Math.floor(i / grid.width)) * grid.width +
          (i % grid.width)) *
        4;
      pixels.data.set([...rgb, 255], at);
    }
    ctx.putImageData(pixels, 0, 0);
  }, [data]);
  return (
    <canvas
      ref={canvas}
      className="chm-preview"
      aria-label={t("树冠分割预览")}
    />
  );
}
export function ChmPanel({ h }) {
  const { t, chm: c } = h;
  if (!c.open) return null;
  return (
    <section className="chm-panel" aria-label={t("CHM 单木分割")}>
      <h3>{t("CHM 单木分割")}</h3>
      <p>{t(h.workspace.region ? "计算当前局部区域" : "计算整份点云")}</p>
      <label>
        {t("地面处理")}
        <select
          aria-label={t("地面处理")}
          value={c.params.groundMode}
          onChange={(e) =>
            c.setParams({ ...c.params, groundMode: e.target.value })
          }
        >
          <option value="auto">{t("优先地面分类，否则自动估计")}</option>
          <option value="classified">{t("仅使用地面分类")}</option>
          <option value="estimate">{t("自动估计地面")}</option>
        </select>
      </label>
      {[
        ["resolution", "CHM 像元（m）", 0.1, 10, 0.1],
        ["terrainResolution", "地面网格（m）", 0.5, 20, 0.5],
        ["minHeight", "最低树高（m）", 0.5, 20, 0.5],
        ["seedDistance", "树顶最小间距（m）", 1, 30, 0.5],
        ["minCrownArea", "最小冠区面积（m²）", 0.1, 100, 0.1],
        ["groundWindow", "地面估计窗口（m）", 2, 40, 1],
        ["tileSize", "处理分块边长（m）", 8, 256, 8],
        ["overlap", "最小边界缓冲（m）", 2, 80, 1],
      ].map(([key, label, min, max, step]) => (
        <label key={key}>
          {t(label)}
          <input
            aria-label={t(label)}
            type="number"
            min={min}
            max={max}
            step={step}
            value={c.params[key]}
            onChange={(e) =>
              c.setParams({ ...c.params, [key]: Number(e.target.value) })
            }
          />
        </label>
      ))}
      <p>{t("缓冲区会按地面估计窗口自动扩大。")}</p>
      <p>{t("沿用归属策略，计算后预览，确认才应用。")}</p>
      <button
        disabled={
          !h.dataset || c.busy || c.job?.status === "running" || !!h.error
        }
        onClick={c.start}
      >
        {t("计算分割")}
      </button>
      {c.job?.status === "running" && (
        <>
          <p role="status">
            {t(
              c.job.progress?.phase === "segment"
                ? "正在分割树冠…"
                : "正在分析点云…",
            )}
          </p>
          <progress
            max={c.job.progress?.totalTiles || c.job.progress?.totalPoints || 1}
            value={
              c.job.progress?.tilesDone || c.job.progress?.processedPoints || 0
            }
          />
          <button onClick={c.cancel}>{t("取消计算")}</button>
        </>
      )}
      {c.job?.status === "cancelled" && <p role="status">{t("计算已取消")}</p>}
      {c.error && <p role="alert">{t(c.error)}</p>}
      {c.result && (
        <>
          <Preview data={c.result.preview} t={t} />
          <p role="status">
            {t("检测到 {0} 个冠区", { 0: c.result.summary.treeCount })}
          </p>
          <p>
            {t("耗时 {0} 秒", {
              0: (c.result.summary.stats.elapsedMs / 1000).toFixed(2),
            })}
          </p>
          {c.result.summary.warnings.map((w) => (
            <p key={w}>{t(w)}</p>
          ))}
          {c.stale && <p role="alert">{t("编辑或区域已改变，请重新计算")}</p>}
          <button
            disabled={c.busy || c.stale || !c.result.summary.treeCount}
            onClick={c.apply}
          >
            {t("应用分割结果")}
          </button>
          <button disabled={c.busy} onClick={() => c.setOpen(false)}>
            {t("收起预览")}
          </button>
        </>
      )}
    </section>
  );
}
