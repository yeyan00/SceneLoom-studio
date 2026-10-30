import React, { useEffect, useRef, useState } from "react";
import { PointCloudRuntime } from "../pointcloud/runtime.js";
import { combineSelection, regionFromLine } from "../../shared/selection.mjs";
import { useBrush } from "./useBrush.js";

const roles = {
  main: "主视图",
  top: "顶视图",
  front: "正视图",
  side: "侧视图",
};
export function PointCloudWorkspace({
  active = true,
  dataset,
  runtime,
  tool,
  setTool,
  selection,
  setSelection,
  invert,
  workspace,
  setWorkspace,
  onStats,
  onError,
  mode,
  edl,
  pointSize,
  budget,
  operations,
  category,
  classColor,
  onBrushCommit,
  onBrushStart,
  brushAction,
  brushLabel = "分类画刷",
  t,
}) {
  const host = useRef(),
    elements = useRef({}),
    gesture = useRef(null),
    latest = useRef();
  latest.current = {
    workspace,
    setWorkspace,
    onStats,
    onError,
    mode,
    edl,
    pointSize,
    budget,
    operations,
    tool,
  };
  const [outline, setOutline] = useState({ view: "main", points: [] }),
    [combine, setCombine] = useState("replace"),
    [regionStep, setRegionStep] = useState(0),
    [depth, setDepth] = useState(false),
    [thickness, setThickness] = useState(10);
  const region = workspace.region,
    quad = !!region && !workspace.single,
    visibleIds = workspace.maximized
      ? [workspace.maximized]
      : quad
        ? Object.keys(roles)
        : ["main"];
  const brush = useBrush({
    action: brushAction,
    tool,
    setTool,
    runtime,
    category,
    color: classColor,
    region,
    onCommit: onBrushCommit,
    onStart: () => {
      setSelection(null);
      onBrushStart();
    },
    onError,
  });
  useEffect(() => {
    const engine = new PointCloudRuntime(
      host.current,
      (value) => latest.current.onStats(value),
      (error) => latest.current.onError(error),
    );
    runtime.current = engine;
    engine.setActive(active);
    engine.configureViews(elements.current, (cameras) =>
      latest.current.setWorkspace((prev) => ({ ...prev, cameras })),
    );
    let cancelled = false;
    engine.setMode(latest.current.mode);
    engine.edlEnabled = latest.current.edl;
    engine.budget = latest.current.budget;
    engine.uniforms.pointSize.value = latest.current.pointSize;
    engine.setOperations(latest.current.operations);
    engine
      .open(dataset)
      .then(() => {
        if (cancelled) return;
        engine.setRegion(latest.current.workspace.region || null);
        engine.restoreViews(latest.current.workspace.cameras);
        engine.setTool(latest.current.tool);
      })
      .catch((error) => {
        if (!cancelled) latest.current.onError(error);
      });
    return () => {
      cancelled = true;
      engine.dispose();
      if (runtime.current === engine) runtime.current = null;
    };
  }, [dataset.id]);
  useEffect(() => {
    const update = () => runtime.current?.setActive(active);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [active, dataset.id]);
  useEffect(() => {
    runtime.current?.setRegion(region || null);
    setSelection(null);
    setOutline({ view: "main", points: [] });
  }, [region]);
  useEffect(() => {
    runtime.current?.setTool(tool);
    if (
      tool === "brush" &&
      latest.current.workspace.maximized &&
      latest.current.workspace.maximized !== "main"
    )
      setWorkspace((prev) => ({ ...prev, maximized: "main" }));
    if (tool !== "region")
      runtime.current?.setRegion(
        latest.current.workspace.region || null,
        false,
      );
    gesture.current = null;
    setRegionStep(0);
    setOutline({ view: "main", points: [] });
  }, [tool]);
  useEffect(() => {
    runtime.current?.setPreview(
      selection ? { selection, invert, scope: region || null } : null,
    );
  }, [selection, invert, region]);
  useEffect(() => {
    requestAnimationFrame(() => {
      runtime.current?.updateViewSizes();
    });
  }, [quad, workspace.maximized]);
  useEffect(() => {
    const cancel = (e) => {
      if (e.code === "Escape") {
        gesture.current = null;
        setRegionStep(0);
        setSelection(null);
        setOutline({ view: "main", points: [] });
        if (tool === "region") {
          runtime.current.setRegion(
            latest.current.workspace.region || null,
            false,
          );
          setTool("navigate");
        }
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [tool]);
  const ndc = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    return [
      ((e.clientX - box.left) / box.width) * 2 - 1,
      1 - ((e.clientY - box.top) / box.height) * 2,
    ];
  };
  function screenSelection(id, points) {
    if (points.length < 3) return;
    const frozen = runtime.current.selection(points, false, id);
    const leaf = {
      kind: "screen",
      matrix: frozen.matrix,
      polygon: frozen.polygon,
    };
    if (depth) {
      const view = runtime.current.views.find((v) => v.id === id),
        camera = view.camera,
        distance = camera.position.distanceTo(view.controls.target),
        near = Math.max(camera.near, distance - thickness / 2),
        far = Math.min(camera.far, distance + thickness / 2);
      const m = camera.projectionMatrix.elements;
      const project = (d) => (-m[10] * d + m[14]) / (-m[11] * d + m[15]);
      leaf.depth = [Math.max(-1, project(near)), Math.min(1, project(far))];
    }
    try {
      setSelection(combineSelection(selection, leaf, combine));
    } catch (error) {
      onError(error);
    }
    setOutline({ view: id, points });
  }
  function pointOnPlane(p) {
    return runtime.current.workPoint(p, runtime.current.controls.target.z);
  }
  function regionDown(p) {
    const point = pointOnPlane(p);
    if (!point) return;
    if (!gesture.current) {
      gesture.current = { a: point, p };
      setRegionStep(1);
    } else if (!gesture.current.b) {
      if (
        Math.hypot(
          point[0] - gesture.current.a[0],
          point[1] - gesture.current.a[1],
        ) < 1e-5
      )
        return;
      gesture.current.b = point;
      gesture.current.q = p;
      setRegionStep(2);
    } else {
      const next = regionAt(point);
      if (!next) return;
      setWorkspace((prev) => ({
        ...prev,
        region: next,
        cameras: undefined,
        maximized: null,
        single: false,
      }));
      gesture.current = null;
      setRegionStep(0);
      setTool("navigate");
      setSelection(null);
    }
  }
  function regionAt(point) {
    const { a, b } = gesture.current || {};
    if (!a || !b) return null;
    const width =
      (2 *
        Math.abs(
          (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]),
        )) /
      Math.hypot(b[0] - a[0], b[1] - a[1]);
    const attr = dataset.metadata.attributes.find((a) => a.name === "position"),
      offset = dataset.metadata.offset[2];
    if (width < 1e-5) return null;
    return regionFromLine(
      a,
      b,
      width,
      attr.min[2] - offset,
      attr.max[2] - offset,
    );
  }
  function down(e, id) {
    if (e.button !== 0 || tool === "navigate") return;
    e.preventDefault();
    const p = ndc(e);
    if (tool === "region") {
      if (id !== "main") return;
      try {
        regionDown(p);
      } catch (error) {
        onError(error);
      }
      return;
    }
    if (tool === "rectangle") {
      gesture.current = { start: p, view: id };
      e.currentTarget.setPointerCapture(e.pointerId);
      setOutline({ view: id, points: [p, p, p, p] });
    } else {
      const points =
        gesture.current?.view === id ? gesture.current.points || [] : [];
      gesture.current = { view: id, points: [...points, p] };
      setOutline({ view: id, points: gesture.current.points });
    }
  }
  function move(e, id) {
    const g = gesture.current;
    if (!g) return;
    const p = ndc(e);
    if (tool === "region" && id === "main") {
      if (g.b) {
        try {
          const point = pointOnPlane(p);
          const next = point && regionAt(point);
          if (next) runtime.current.setRegion(next, false);
        } catch {}
      }
      setOutline({ view: id, points: [g.p, g.q || p, p] });
      return;
    }
    if (tool === "rectangle" && g.view === id) {
      const a = g.start;
      setOutline({ view: id, points: [a, [p[0], a[1]], p, [a[0], p[1]]] });
    }
  }
  function up(e, id) {
    const g = gesture.current;
    if (tool !== "rectangle" || g?.view !== id) return;
    gesture.current = null;
    const a = g.start,
      b = ndc(e);
    if (Math.abs(a[0] - b[0]) < 0.005 || Math.abs(a[1] - b[1]) < 0.005) return;
    screenSelection(id, [a, [b[0], a[1]], b, [a[0], b[1]]]);
  }
  function patchRegion(update) {
    setWorkspace((prev) => ({
      ...prev,
      region: { ...prev.region, ...update },
      cameras: undefined,
    }));
  }
  return (
    <>
      <div className="workspace-tools">
        <button onClick={() => runtime.current?.fit()}>{t("适应视图")}</button>
        <button
          className={tool === "brush" ? "selected" : ""}
          onClick={() => setTool("brush")}
        >
          {t(brushLabel)}
        </button>
        {tool === "brush" && (
          <>
            <label>
              {t("画刷直径")}
              <input
                aria-label={t("画刷直径")}
                type="number"
                min="4"
                max="512"
                value={Math.round(brush.radius * 2)}
                onChange={(e) => {
                  if (Number(e.target.value) > 0)
                    brush.resize(Number(e.target.value) / 2);
                }}
              />
              px
            </label>
            <span>{t("穿透 · 左键涂刷 · +/- 调整大小 · 空格导航")}</span>
          </>
        )}
        <button
          className={tool === "region" ? "selected" : ""}
          onClick={() => {
            setWorkspace((prev) => ({ ...prev, maximized: "main" }));
            setSelection(null);
            setTool("region");
          }}
        >
          {t("局部截取")}
        </button>
        {region && (
          <>
            <button
              onClick={() =>
                setWorkspace((prev) => ({
                  ...prev,
                  region: null,
                  maximized: null,
                  single: false,
                  cameras: undefined,
                }))
              }
            >
              {t("清除区域")}
            </button>
            <button
              onClick={() =>
                setWorkspace((prev) => ({
                  ...prev,
                  single: !prev.single,
                  maximized: null,
                }))
              }
            >
              {t(workspace.single ? "四视图" : "单视图")}
            </button>
          </>
        )}
        {tool !== "brush" && (
          <>
            <label>
              {t("选区组合")}
              <select
                aria-label={t("选区组合")}
                value={combine}
                onChange={(e) => setCombine(e.target.value)}
              >
                {[
                  ["replace", "替换"],
                  ["union", "并集"],
                  ["difference", "减选"],
                  ["intersection", "交集"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!selection}
              onClick={() => {
                setSelection(null);
                setOutline({ view: "main", points: [] });
              }}
            >
              {t("清除选区")}
            </button>
            <label>
              <input
                type="checkbox"
                checked={depth}
                onChange={(e) => setDepth(e.target.checked)}
              />
              {t("限制选择深度")}
            </label>
            {depth && (
              <label>
                {t("深度厚度")}
                <input
                  aria-label={t("深度厚度")}
                  type="number"
                  min=".01"
                  step="1"
                  value={thickness}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (value > 0) setThickness(value);
                  }}
                />
              </label>
            )}
          </>
        )}
        {region && (
          <>
            <span className="scope-badge">{t("局部编辑")}</span>
            <label>
              {t("区域宽度")}
              <input
                aria-label={t("区域宽度")}
                type="number"
                min=".01"
                value={Number((region.half[1] * 2).toFixed(3))}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0)
                    patchRegion({
                      half: [region.half[0], v / 2, region.half[2]],
                    });
                }}
              />
            </label>
            <label>
              {t("高度下界")}
              <input
                aria-label={t("高度下界")}
                type="number"
                value={Number(
                  (
                    region.center[2] -
                    region.half[2] +
                    dataset.metadata.offset[2]
                  ).toFixed(3),
                )}
                onChange={(e) => {
                  const lo =
                      Number(e.target.value) - dataset.metadata.offset[2],
                    hi = region.center[2] + region.half[2];
                  if (lo < hi)
                    patchRegion({
                      center: [...region.center.slice(0, 2), (lo + hi) / 2],
                      half: [...region.half.slice(0, 2), (hi - lo) / 2],
                    });
                }}
              />
            </label>
            <label>
              {t("高度上界")}
              <input
                aria-label={t("高度上界")}
                type="number"
                value={Number(
                  (
                    region.center[2] +
                    region.half[2] +
                    dataset.metadata.offset[2]
                  ).toFixed(3),
                )}
                onChange={(e) => {
                  const hi =
                      Number(e.target.value) - dataset.metadata.offset[2],
                    lo = region.center[2] - region.half[2];
                  if (lo < hi)
                    patchRegion({
                      center: [...region.center.slice(0, 2), (lo + hi) / 2],
                      half: [...region.half.slice(0, 2), (hi - lo) / 2],
                    });
                }}
              />
            </label>
          </>
        )}
      </div>
      <div className="viewport multi-workspace" data-testid="viewport">
        <div ref={host} className="canvas-host" />
        <div className={"view-grid " + (visibleIds.length > 1 ? "quad" : "")}>
          {Object.entries(roles).map(([id, label]) => (
            <div
              key={id}
              ref={(element) => {
                if (element) elements.current[id] = element;
              }}
              data-testid={"view-" + id}
              className="view-cell"
              style={{ display: visibleIds.includes(id) ? "block" : "none" }}
            >
              <div
                className="cell-heading"
                onPointerDownCapture={(e) => e.stopPropagation()}
              >
                <span>{t(label)}</span>
                <div>
                  {id !== "main" && (
                    <button
                      aria-label={t("切换方向锁定") + " " + t(label)}
                      aria-pressed={workspace.cameras?.[id]?.locked !== false}
                      onClick={() => {
                        const view = runtime.current.views.find(
                          (v) => v.id === id,
                        );
                        runtime.current.setLocked(id, !view.locked);
                        setWorkspace((prev) => ({
                          ...prev,
                          cameras: runtime.current.viewState(),
                        }));
                      }}
                    >
                      {t(
                        workspace.cameras?.[id]?.locked === false
                          ? "锁定方向"
                          : "解锁旋转",
                      )}
                    </button>
                  )}
                  <button
                    aria-label={t("适应视图") + " " + t(label)}
                    onClick={() => {
                      runtime.current.fit(id);
                      setWorkspace((prev) => ({
                        ...prev,
                        cameras: runtime.current.viewState(),
                      }));
                    }}
                  >
                    {t("适应")}
                  </button>
                  <button
                    aria-label={t("最大化") + " " + t(label)}
                    onClick={() =>
                      setWorkspace((prev) => ({
                        ...prev,
                        maximized: prev.maximized === id ? null : id,
                      }))
                    }
                  >
                    {t(workspace.maximized === id ? "还原" : "最大化")}
                  </button>
                </div>
              </div>
              <svg
                tabIndex={tool === "brush" && id === "main" ? -1 : undefined}
                className={
                  "selection-overlay " +
                  (tool === "navigate" ||
                  (tool === "region" && id !== "main") ||
                  (tool === "brush" && (brush.navigating || id !== "main"))
                    ? "passive"
                    : "")
                }
                onPointerDown={(e) => down(e, id)}
                onPointerMove={(e) => move(e, id)}
                onPointerUp={(e) => up(e, id)}
                {...(tool === "brush" && id === "main" ? brush.handlers : {})}
                style={
                  tool === "brush" && !brush.navigating && id === "main"
                    ? { cursor: "none" }
                    : undefined
                }
                onDoubleClick={() => {
                  if (tool === "polygon" && gesture.current?.view === id) {
                    screenSelection(id, gesture.current.points);
                    gesture.current = null;
                  }
                }}
                viewBox="-1 -1 2 2"
                preserveAspectRatio="none"
              >
                {outline.view === id && (
                  <polygon
                    points={outline.points
                      .map(([x, y]) => `${x},${-y}`)
                      .join(" ")}
                    fill="rgba(94,190,186,.12)"
                    stroke="#65d8cb"
                    strokeWidth=".003"
                  />
                )}
              </svg>
              {tool === "brush" && id === "main" && !brush.navigating && (
                <div
                  ref={brush.cursor}
                  className="brush-cursor"
                  style={{
                    borderColor: classColor,
                    width: brush.radius * 2,
                    height: brush.radius * 2,
                  }}
                />
              )}
              <div className="view-hint">
                {tool === "brush"
                  ? t(
                      id === "main"
                        ? brushLabel === "分类画刷"
                          ? "按住左键分类，松开完成一笔"
                          : "按住左键编辑单木，松开完成一笔"
                        : "画刷仅用于主视图",
                    )
                  : tool === "region"
                    ? t(
                        regionStep === 0
                          ? "点击中心线起点"
                          : regionStep === 1
                            ? "点击中心线终点"
                            : "移动调整宽度，点击确认",
                      )
                    : selection
                      ? t("选区已冻结，可赋类或删除")
                      : t(
                          id === "main"
                            ? "左键旋转 · 右键平移 · 滚轮缩放"
                            : "方向锁定时仍可平移缩放",
                        )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
