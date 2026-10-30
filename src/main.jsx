import { studioPlugins, StudioPlugins } from "./plugins/index.jsx";
import { ExtensionWorkspace } from "./plugins/context.jsx";
import React, { useEffect, useRef, useState, useMemo, useReducer } from "react";
import { createRoot } from "react-dom/client";
import {
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  MousePointer2,
  Scan,
  BoxSelect,
  Lasso,
  Paintbrush,
  Trash2,
  Tags,
  Layers3,
  SlidersHorizontal,
  Wrench,
  Settings,
  ClipboardList,
  Plus,
  Check,
  X,
  PanelLeft,
  FileText,
  Languages,
  PanelRight,
  ChevronsUp,
  ChevronsDown,
} from "lucide-react";
import { PointCloudWorkspace } from "./editor/PointCloudWorkspace.jsx";
import { useEditHistory } from "./editor/useEditHistory.js";
import { editSignature } from "../shared/history.mjs";
import { useI18n } from "./i18n.jsx";
import { api, activity } from "./api.js";
import { Toolbox } from "./panels/Toolbox.jsx";
import { DockTabs } from "./panels/DockTabs.jsx";
import { dockReducer, emptyDock } from "./panels/dock-state.mjs";
import { TaskPanel } from "./panels/TaskPanel.jsx";
import { useTasks } from "./panels/useTasks.js";
import { ViewRibbon } from "./panels/ViewRibbon.jsx";
import { LogPanel } from "./panels/LogPanel.jsx";
import { ToolDialog } from "./panels/ToolDialog.jsx";
import { PackageDialog } from "./panels/PackageDialog.jsx";
import { LabelSetDialog } from "./panels/LabelSetDialog.jsx";
import { ViewTabs } from "./views/ViewTabs.jsx";
import { TilesView } from "./views/TilesView.jsx";
import { desktop, pickProjectDestination } from "./desktop.js";
import { ProjectDataTree } from "./panels/ProjectDataTree.jsx";
import { OpenDataForm } from "./panels/OpenDataForm.jsx";
import {
  RibbonButton as Button,
  RibbonSplitButton,
} from "./components/Ribbon.jsx";
import { GaussianView } from "./views/GaussianView.jsx";
import {
  lasLabelSet,
  labelSetForSession,
  matchesClass,
} from "../shared/label-sets.mjs";
import "./style.css";

function RenderResourceView(props) {
  return props.resource.type === "tiles" ? (
    <TilesView {...props} />
  ) : (
    <GaussianView {...props} />
  );
}

function App() {
  const { t, locale, setLocale, format } = useI18n();
  const history = useEditHistory();
  const { operations, cursor } = history;
  const [workspace, setWorkspace] = useState({ region: null });
  const [saving, setSaving] = useState(false);
  const [packageJob, setPackageJob] = useState(null);
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth >= 900);
  const [dock, dispatchDock] = useReducer(dockReducer, emptyDock);
  const [ribbonOpen, setRibbonOpen] = useState(true);
  const [selectionTool, setSelectionTool] = useState("rectangle");
  const [renderViews, setRenderViews] = useState([]);
  const [pointDatasets, setPointDatasets] = useState([]);
  const [renderSources, setRenderSources] = useState([]);
  const [dataType, setDataType] = useState("auto");
  const [projectFile, setProjectFile] = useState("");
  const [projectDestination, setProjectDestination] = useState("");
  const [activeView, setActiveView] = useState("pointcloud");
  const [visitedViews, setVisitedViews] = useState([]);
  const [renderStats, setRenderStats] = useState({});
  const [closingGaussian, setClosingGaussian] = useState(null);
  const renderViewActive = activeView !== "pointcloud";
  const panelDefinitions = [
    { id: "properties", label: "属性", icon: SlidersHorizontal },
    { id: "tools", label: "工具箱", icon: Wrench },
    { id: "tasks", label: "任务", icon: ClipboardList },
    ...studioPlugins.map((plugin) => ({
      id: plugin.id,
      label: plugin.panelLabel,
      pointOnly: true,
    })),
  ];
  const dockEntries = dock.open
    .map((id) => panelDefinitions.find((panel) => panel.id === id))
    .filter((panel) => panel && !(panel.pointOnly && renderViewActive));
  const dockTab = dockEntries.some((panel) => panel.id === dock.active)
    ? dock.active
    : dockEntries.at(-1)?.id;
  const rightOpen = !dock.collapsed && dockEntries.length > 0;
  const activeResource = renderViews.find((v) => v.id === activeView);
  function activateView(id) {
    runtime.current?.cancelActiveBrush?.();
    setTool("navigate");
    setActiveView(id);
    setVisitedViews((prev) => (prev.includes(id) ? prev : [...prev, id]));
    if (
      id !== "pointcloud" &&
      ["edit", "render", ...studioPlugins.map((plugin) => plugin.id)].includes(
        tab,
      )
    )
      setTab("project");
  }
  async function closeRenderView(id, discard = false) {
    if (renderStats[id]?.dirty && !discard) {
      setClosingGaussian(id);
      return;
    }
    try {
      await api(
        `/${renderViews.find((v) => v.id === id)?.type === "tiles" ? "tiles" : "splats"}/${id}/close`,
        {},
      );
      setClosingGaussian(null);
      setRenderViews((prev) => prev.filter((v) => v.id !== id));
      setVisitedViews((prev) => prev.filter((v) => v !== id));
      setActiveView((current) => (current === id ? "pointcloud" : current));
    } catch (e) {
      fail(e);
    }
  }
  useEffect(() => {
    Promise.all([api("/splats"), api("/tiles")])
      .then((results) => {
        const views = results.flatMap((r) => r.views),
          unavailable = results.flatMap((r) => r.unavailable);
        setRenderViews((previous) => [
          ...previous,
          ...views.filter(
            (view) => !previous.some((item) => item.id === view.id),
          ),
        ]);
        setRenderSources((previous) => [
          ...previous,
          ...views.filter(
            (view) => !previous.some((item) => item.path === view.path),
          ),
        ]);
        if (unavailable.length)
          activity("Some 3DGS sources unavailable", "warn", { unavailable });
      })
      .catch(fail);
  }, []);
  const [dataset, setDataset] = useState(null),
    [dialog, setDialog] = useState(null),
    [input, setInput] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [conversion, setConversion] = useState(null),
    [tool, setTool] = useState("navigate"),
    [selection, setSelection] = useState(null),
    [invert, setInvert] = useState(false),
    [labelSet, setLabelSet] = useState(lasLabelSet),
    [classQuery, setClassQuery] = useState(""),
    [category, setCategory] = useState(2),
    [tab, setTab] = useState("project"),
    [mode, setMode] = useState("height"),
    [pointSize, setPointSize] = useState(2),
    [edl, setEdl] = useState(true),
    [budget, setBudget] = useState(600000),
    [stats, setStats] = useState({}),
    [settings, setSettings] = useState({
      storageMode: "adjacent",
      dataDirectory: "",
    }),
    [saved, setSaved] = useState(""),
    [logOpen, setLogOpen] = useState(false),
    [tools, setTools] = useState([]),
    [selectedTool, setSelectedTool] = useState(null);
  const classes = labelSet.classes;
  const observedIds = [
    ...new Set([
      ...(stats.observedCategories || []),
      ...operations
        .slice(0, cursor)
        .filter((op) => op.type === "classify")
        .map((op) => op.category),
    ]),
  ].sort((a, b) => a - b);
  const displayClasses = [
    ...classes,
    ...observedIds
      .filter((id) => !classes.some((c) => c.id === id))
      .map((id) => ({
        id,
        name: `ID ${id}`,
        aliases: [],
        color: "#b380e6",
        undefined: true,
      })),
  ];
  const runtime = useRef(),
    recoveryPending = useRef(false),
    persist = useRef(Promise.resolve()),
    timer = useRef();
  const signature = useMemo(
    () => editSignature({ operations, cursor, classes, labelSet, workspace }),
    [operations, cursor, classes, labelSet, workspace.region],
  );
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  const activeDataset = useRef(dataset);
  activeDataset.current = dataset;
  function openDock(panel) {
    dispatchDock({ type: "open", id: panel });
  }
  function closeDock(panel) {
    dispatchDock({ type: "close", id: panel });
  }
  function toggleDock(panel) {
    if (rightOpen && dockTab === panel) closeDock(panel);
    else openDock(panel);
  }
  function openLogs() {
    setLogOpen(true);
    if (window.innerWidth < 760) dispatchDock({ type: "collapse" });
  }
  function runRegisteredTool(entry) {
    activity("Tool selected", "info", { toolId: entry.id });
    if (entry.action === "open-source") setDialog("open");
    else if (entry.action === "logs") openLogs();
    else {
      setSelectedTool(entry);
      setDialog("tool");
    }
  }
  useEffect(() => {
    api("/tools")
      .then((result) => setTools(result.tools))
      .catch(fail);
    const onError = (e) =>
      activity(e.message || "Unhandled browser error", "error", {
        stack: e.error?.stack,
      });
    const onRejection = (e) =>
      activity(String(e.reason?.message || e.reason), "error", {
        stack: e.reason?.stack,
      });
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyJ") {
        e.preventDefault();
        setLogOpen((value) => !value);
      }
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  useEffect(() => {
    if (notice) activity(notice);
  }, [notice]);
  useEffect(() => {
    if (error) activity(error, "error");
  }, [error]);
  useEffect(() => {
    activity("Display settings changed", "info", { mode, edl });
  }, [mode, edl]);
  useEffect(() => {
    activity("Language changed", "info", { locale });
  }, [locale]);
  useEffect(() => {
    if (dataset)
      activity("Edit history changed", "info", {
        datasetId: dataset.id,
        cursor,
        operationCount: operations.length,
        operationId: operations[cursor - 1]?.id,
      });
  }, [dataset?.id, cursor, operations]);
  useEffect(() => {
    if (runtime.current) runtime.current.edlEnabled = edl;
  }, [edl, dataset?.id]);
  const dirty = !!dataset && signature !== saved;
  const exitDirty = useRef(false);
  exitDirty.current = dirty || Object.values(renderStats).some((s) => s.dirty);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false,
      unlisten;
    import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const off = await getCurrentWindow().onCloseRequested((event) => {
        if (
          exitDirty.current &&
          !window.confirm(t("有未保存的编辑，确定退出？"))
        )
          event.preventDefault();
      });
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const fail = (e) => setError(e.message || String(e));
  useEffect(() => {
    api("/settings").then(setSettings).catch(fail);
  }, []);
  useEffect(() => {
    const handler = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    runtime.current?.setOperations(operations.slice(0, cursor));
  }, [operations, cursor]);
  useEffect(() => {
    runtime.current?.setMode(mode);
  }, [mode, dataset?.id]);
  useEffect(() => {
    runtime.current?.setClasses(classes);
  }, [classes, dataset?.id]);
  useEffect(() => {
    if (runtime.current) runtime.current.uniforms.pointSize.value = pointSize;
  }, [pointSize, dataset?.id]);
  useEffect(() => {
    if (runtime.current) runtime.current.budget = budget;
  }, [budget, dataset?.id]);
  useEffect(() => {
    runtime.current?.setTool(tool);
  }, [tool, dataset?.id]);
  const snapshot = () => ({
    sourceRevision: dataset.revision,
    operations,
    cursor,
    classes,
    labelSet,
    workspace,
  });
  function enqueue(url, value) {
    const next = persist.current.catch(() => {}).then(() => api(url, value));
    persist.current = next;
    return next;
  }
  useEffect(() => {
    clearTimeout(timer.current);
    if (!dataset) return;
    if (dirty) recoveryPending.current = true;
    if (!recoveryPending.current) return;
    const value = snapshot();
    timer.current = setTimeout(
      () =>
        enqueue(`/datasets/${dataset.id}/session`, value)
          .then(() => {
            if (!dirty) recoveryPending.current = false;
          })
          .catch(fail),
      350,
    );
    return () => clearTimeout(timer.current);
  }, [signature, dataset?.id, saved]);
  function accept(ds) {
    clearTimeout(timer.current);
    recoveryPending.current = false;
    setDataset(ds);
    setTab("edit");
    setPointDatasets((previous) => [
      ...previous.filter(
        (item) =>
          item.id !== ds.id &&
          item.folder !== ds.folder &&
          item.projectPath !== ds.projectPath,
      ),
      ds,
    ]);
    history.reset(ds.session.operations, ds.session.cursor);
    setWorkspace(ds.session.workspace || { region: null });
    const labels = labelSetForSession(ds.session);
    setLabelSet(labels);
    setCategory(
      labels.classes.find((c) => c.id === 2 && !c.reserved)?.id ??
        labels.classes.find((c) => !c.reserved)?.id ??
        0,
    );
    setClassQuery("");
    setSaved(
      ds.recovered
        ? ""
        : editSignature({
            operations: ds.session.operations || [],
            cursor: ds.session.cursor || 0,
            classes: labels.classes,
            labelSet: labels,
            workspace: ds.session.workspace || { region: null },
          }),
    );
    setSelection(null);
    setStats({});
    setTool("navigate");
    setNotice(
      ds.recovered
        ? "已恢复上次未保存的编辑会话"
        : "数据已打开，源文件保持不变",
    );
  }
  async function preservePointSession() {
    const brushCommand = runtime.current?.commitActiveBrush?.();
    if (!dataset || (!dirty && !brushCommand)) return;
    clearTimeout(timer.current);
    const value = snapshot();
    if (brushCommand) {
      value.operations = [
        ...value.operations.slice(0, value.cursor),
        brushCommand,
      ];
      value.cursor++;
    }
    await enqueue(`/datasets/${dataset.id}/session`, value);
  }
  const taskManager = useTasks({
    onComplete: async (task) => {
      if (task.toolId === "builtin.potree") {
        const result = await api(`/jobs/${task.id}`);
        if (result.dataset) {
          await preservePointSession();
          accept(result.dataset);
          activateView("pointcloud");
        }
      }
      setNotice(
        task.toolId === "builtin.potree"
          ? "转换完成，已自动加载"
          : "工具任务已完成",
      );
    },
    onFailure: (task) => setError(task.error || "任务失败"),
    onError: fail,
  });
  function addRenderResource(view) {
    setRenderViews((previous) => [
      ...previous.filter(
        (item) => item.id !== view.id && item.path !== view.path,
      ),
      view,
    ]);
    setRenderSources((previous) => [
      ...previous.filter(
        (item) => item.id !== view.id && item.path !== view.path,
      ),
      view,
    ]);
  }
  async function saveDataProject() {
    if (busy || !projectDestination.trim()) return;
    setBusy(true);
    try {
      await preservePointSession();
      const result = await api("/project-collection", {
        path: projectDestination.trim(),
        resources: [
          ...pointDatasets.map((item) => ({
            type: "pointcloud",
            path: item.projectPath,
          })),
          ...renderSources.map((item) => ({
            type: item.type,
            path: item.path,
          })),
        ],
      });
      setProjectFile(result.path);
      setDialog(null);
      setNotice("项目数据引用已保存，编辑状态由各数据集独立保存");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }
  async function open(source = input, selectedType = dataType) {
    if (typeof source !== "string") source = input;
    if (saving || busy) return;
    setBusy(true);
    setError("");
    try {
      await preservePointSession();
      const result = await api("/open", {
        path: source.trim().replace(/^"|"$/g, ""),
        type: selectedType,
      });
      if (result.kind === "project") {
        setProjectFile(result.path);
        for (const item of result.results) {
          if (item.dataset) accept(item.dataset);
          else if (item.view) addRenderResource(item.view);
        }
        for (const item of result.unavailable) {
          const name = item.path.split(/[\\/]/).at(-1);
          if (item.type === "pointcloud") {
            setPointDatasets((previous) =>
              previous.some((entry) => entry.projectPath === item.path)
                ? previous
                : [
                    ...previous,
                    {
                      id: item.path,
                      projectPath: item.path,
                      metadata: { name, points: 0 },
                      unavailable: item.error,
                    },
                  ],
            );
          } else {
            setRenderSources((previous) =>
              previous.some((entry) => entry.path === item.path)
                ? previous
                : [
                    ...previous,
                    {
                      id: item.path,
                      type: item.type,
                      path: item.path,
                      name,
                      unavailable: item.error,
                    },
                  ],
            );
          }
        }
        const last = result.results.at(-1);
        if (last) activateView(last.view?.id || "pointcloud");
        setDialog(null);
        setNotice(
          result.unavailable.length
            ? "项目已打开，部分数据源不可用"
            : "项目数据已打开",
        );
        if (result.unavailable.length) {
          setError(
            result.unavailable
              .map((item) => `${item.path}: ${item.error}`)
              .join("\n"),
          );
        }
      } else if (["gaussian", "tiles"].includes(result.kind)) {
        addRenderResource(result.view);
        activateView(result.view.id);
        setDialog(null);
        setNotice(
          result.kind === "tiles"
            ? "3D Tiles 已在独立视图中打开"
            : "3DGS 已在独立视图中打开",
        );
      } else if (result.kind === "convert") {
        setConversion(result);
        setDialog("convert");
      } else {
        accept(result.dataset);
        activateView("pointcloud");
        setDialog(null);
        if (result.reused) setNotice("已复用现有转换数据");
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (renderViewActive) return;
    const brushCommand = runtime.current?.commitActiveBrush?.();
    const owner = dataset;
    clearTimeout(timer.current);
    setBusy(true);
    setSaving(true);
    try {
      const value = snapshot();
      if (brushCommand) {
        value.operations = [
          ...value.operations.slice(0, value.cursor),
          brushCommand,
        ];
        value.cursor++;
      }
      await enqueue(`/datasets/${dataset.id}/save`, value);
      if (activeDataset.current !== owner) return;
      if (currentSignature.current === editSignature(value))
        recoveryPending.current = false;
      setSaved(
        editSignature({
          operations: value.operations,
          cursor: value.cursor,
          classes: value.classes,
          labelSet: value.labelSet,
          workspace: value.workspace,
        }),
      );
      setNotice("工程已保存");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      setSaving(false);
    }
  }
  async function startConversion() {
    setBusy(true);
    try {
      const result = await api("/convert", { source: conversion.source });
      if (result.dataset) {
        accept(result.dataset);
        activateView("pointcloud");
        setDialog(null);
      } else {
        taskManager.track(result);
        setDialog(null);
        openDock("tasks");
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  function apply(type) {
    if (!selection) return;
    const op = {
      selection,
      scope: workspace.region || null,
      invert,
      type,
      category,
      id: crypto.randomUUID(),
    };
    history.commit(op);
    setSelection(null);
    if (type === "classify") setMode("classification");
    setNotice(type === "delete" ? "已删除选中点" : "已更新选中点类别");
  }
  useEffect(() => {
    const key = (e) => {
      const editable = e.target.closest?.(
        "input,textarea,select,[contenteditable=true]",
      );
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") {
        e.preventDefault();
        if (dataset && !busy && !renderViewActive) save();
        return;
      }
      if (editable) return;
      if (renderViewActive) return;
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
        e.preventDefault();
        runtime.current?.cancelActiveBrush?.();
        e.shiftKey ? history.redo() : history.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") {
        e.preventDefault();
        runtime.current?.cancelActiveBrush?.();
        history.redo();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [dataset, operations, cursor, classes, workspace, busy, renderViewActive]);
  const tabs = [
    ["project", t("工程")],
    ["edit", t("点云编辑")],
    ["render", t("点云渲染")],
  ];
  const PluginRibbon = studioPlugins.find((p) => p.id === tab)?.Ribbon;
  return (
    <StudioPlugins
      host={{
        dataset,
        operations,
        cursor,
        selection,
        setSelection,
        invert,
        workspace,
        history,
        labelSet,
        t,
        runtime,
        tab,
        setTab,
        tool,
        setTool,
        setMode,
        openDock,
        onError: fail,
      }}
    >
      <div
        className={`app ${leftOpen ? "show-left" : ""} ${rightOpen ? "show-right" : ""} ${ribbonOpen ? "" : "ribbon-collapsed"}`}
      >
        <nav className="tabs">
          {[
            ...tabs,
            ...studioPlugins.map((p) => [p.id, t(p.label)]),
            ["view", t("视图")],
          ].map(([id, label]) => (
            <button
              key={id}
              disabled={
                renderViewActive &&
                ["edit", "render", ...studioPlugins.map((p) => p.id)].includes(
                  id,
                )
              }
              className={tab === id ? "active" : ""}
              onClick={() => {
                runtime.current?.cancelActiveBrush?.();
                if (id !== tab) setTool("navigate");
                setTab(id);
              }}
            >
              {label}
            </button>
          ))}
          <div className="quick">
            <label className="language-picker">
              <Languages size={14} />
              <select
                aria-label={t("语言")}
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
              >
                <option value="zh-CN">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <button title={t("打开")} onClick={() => setDialog("open")}>
              <FolderOpen size={16} />
            </button>
            <button
              title={t("保存工程")}
              disabled={!dataset || busy || renderViewActive}
              onClick={save}
            >
              <Save size={16} />
            </button>
            <span className="divider" />
            <button title={t("设置")} onClick={() => setDialog("settings")}>
              <Settings size={16} />
            </button>
          </div>
          <span className="local-badge">
            <i />
            {t("本地工作空间")}
          </span>
          <div className="layout-controls">
            <button
              title={t("显示工程面板")}
              aria-label={t("显示工程面板")}
              aria-expanded={leftOpen}
              onClick={() => setLeftOpen(!leftOpen)}
            >
              <PanelLeft size={15} />
            </button>
            <button
              title={t("显示属性面板")}
              aria-label={t("显示属性面板")}
              aria-expanded={rightOpen && dockTab === "properties"}
              onClick={() => toggleDock("properties")}
            >
              <PanelRight size={15} />
            </button>
            <button
              title={t(ribbonOpen ? "折叠功能区" : "展开功能区")}
              aria-label={t(ribbonOpen ? "折叠功能区" : "展开功能区")}
              aria-expanded={ribbonOpen}
              onClick={() => setRibbonOpen(!ribbonOpen)}
            >
              {ribbonOpen ? (
                <ChevronsUp size={15} />
              ) : (
                <ChevronsDown size={15} />
              )}
            </button>
          </div>
        </nav>
        <section className="ribbon">
          {tab === "project" && (
            <div className="ribbon-group">
              <div className="ribbon-actions">
                <Button
                  large
                  icon={FolderOpen}
                  onClick={() => setDialog("open")}
                >
                  {t("打开数据")}
                </Button>
                <div className="ribbon-stack">
                  <Button
                    icon={Save}
                    disabled={!dataset || busy || renderViewActive}
                    onClick={save}
                  >
                    {t("保存工程")}
                  </Button>
                  <Button
                    icon={FolderOpen}
                    disabled={renderViewActive}
                    onClick={() => setDialog("package")}
                  >
                    {t("打包工程")}
                  </Button>
                </div>
              </div>
            </div>
          )}
          {tab === "view" ? (
            <ViewRibbon
              panels={panelDefinitions}
              activePanel={rightOpen ? dockTab : null}
              leftOpen={leftOpen}
              logOpen={logOpen}
              renderViewActive={renderViewActive}
              t={t}
              onProject={() => setLeftOpen(!leftOpen)}
              onPanel={toggleDock}
              onLogs={() => (logOpen ? setLogOpen(false) : openLogs())}
            />
          ) : renderViewActive ? (
            <div className="ribbon-group">
              <div className="ribbon-actions">
                <span className="render-view-caption">
                  {t(
                    activeResource?.type === "tiles"
                      ? "3D Tiles 视图"
                      : "3DGS 编辑视图",
                  )}
                </span>
                <Button
                  icon={BoxSelect}
                  onClick={() => activateView("pointcloud")}
                >
                  {t("返回点云视图")}
                </Button>
              </div>
            </div>
          ) : tab === "render" ? (
            <div className="ribbon-group">
              <fieldset className="ribbon-render-controls" disabled={!dataset}>
                <label className="ribbon-render-control">
                  {t("着色方式")}
                  <select
                    aria-label={t("着色方式")}
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="height">{t("高程")}</option>
                    <option value="rgb">{t("RGB 原色")}</option>
                    <option value="classification">{t("分类")}</option>
                    {studioPlugins
                      .flatMap((p) => p.displayModes || [])
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {t(m.label)}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="ribbon-render-control">
                  {t("点大小")}
                  <span>{pointSize}px</span>
                  <input
                    aria-label={t("点大小")}
                    type="range"
                    min="1"
                    max="6"
                    step=".5"
                    value={pointSize}
                    onChange={(e) => setPointSize(+e.target.value)}
                  />
                </label>
                <label className="ribbon-render-control">
                  {t("显示点预算")}
                  <select
                    aria-label={t("显示点预算")}
                    value={budget}
                    onChange={(e) => setBudget(+e.target.value)}
                  >
                    {[200000, 600000, 1200000, 2400000].map((n) => (
                      <option key={n} value={n}>
                        {t("{0} 点", { 0: format(n) })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ribbon-render-control">
                  {t("EDL 深度增强")}
                  <input
                    aria-label={t("EDL 深度增强")}
                    type="checkbox"
                    checked={edl}
                    onChange={(e) => setEdl(e.target.checked)}
                    style={{ width: "auto", accentColor: "#278c87" }}
                  />
                </label>
              </fieldset>
            </div>
          ) : tab === "edit" ? (
            <>
              <div className="ribbon-group">
                <div className="ribbon-actions">
                  <Button
                    large
                    icon={Tags}
                    onClick={() => {
                      runtime.current?.cancelActiveBrush?.();
                      setDialog("labels");
                    }}
                  >
                    {t("管理标签集")}
                  </Button>
                </div>
              </div>
              <div className="ribbon-group">
                <div className="ribbon-actions">
                  <Button
                    large
                    icon={MousePointer2}
                    className={tool === "navigate" ? "selected" : ""}
                    onClick={() => setTool("navigate")}
                  >
                    {t("浏览")}
                  </Button>
                  <RibbonSplitButton
                    label={t(
                      selectionTool === "polygon"
                        ? "多边形"
                        : selectionTool === "brush"
                          ? "分类画刷"
                          : "矩形",
                    )}
                    icon={
                      selectionTool === "polygon"
                        ? Lasso
                        : selectionTool === "brush"
                          ? Paintbrush
                          : BoxSelect
                    }
                    menuLabel={t("选择工具")}
                    disabled={!dataset}
                    value={selectionTool}
                    selected={["rectangle", "polygon", "brush"].includes(tool)}
                    options={[
                      { value: "rectangle", label: t("矩形"), icon: BoxSelect },
                      { value: "polygon", label: t("多边形"), icon: Lasso },
                      {
                        value: "brush",
                        label: t("分类画刷"),
                        icon: Paintbrush,
                      },
                    ]}
                    onSelect={(value) => {
                      runtime.current?.cancelActiveBrush?.();
                      setSelectionTool(value);
                      setTool(value);
                    }}
                  />
                </div>
              </div>
              <div className="ribbon-group">
                <div className="ribbon-actions">
                  <Button
                    large
                    icon={Tags}
                    disabled={!selection}
                    onClick={() => apply("classify")}
                  >
                    {t("赋予类别")}
                  </Button>
                  <div className="ribbon-stack">
                    <Button
                      icon={Trash2}
                      disabled={!selection}
                      onClick={() => apply("delete")}
                    >
                      {t("删除选区")}
                    </Button>
                    <Button
                      icon={Scan}
                      disabled={!selection}
                      className={invert ? "selected" : ""}
                      onClick={() => setInvert(!invert)}
                    >
                      {t("反选")}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="ribbon-group">
                <div className="ribbon-actions ribbon-stack">
                  <Button
                    icon={Undo2}
                    disabled={!cursor}
                    onClick={() => {
                      runtime.current?.cancelActiveBrush?.();
                      history.undo();
                    }}
                  >
                    {t("撤销")}
                  </Button>
                  <Button
                    icon={Redo2}
                    disabled={cursor === operations.length}
                    onClick={() => {
                      runtime.current?.cancelActiveBrush?.();
                      history.redo();
                    }}
                  >
                    {t("重做")}
                  </Button>
                </div>
              </div>
            </>
          ) : PluginRibbon ? (
            <PluginRibbon />
          ) : null}
        </section>
        <main>
          <aside className="left-panel">
            <div className="panel-title">
              <Layers3 size={15} />
              {t("工程浏览器")}
              <PanelLeft size={14} />
            </div>
            <ProjectDataTree
              points={pointDatasets}
              sources={renderSources}
              dataset={dataset}
              activeView={activeView}
              busy={busy || saving}
              t={t}
              format={format}
              onPoint={(entry) => {
                if (entry.id === dataset?.id) {
                  activateView("pointcloud");
                  return;
                }
                open(entry.projectPath, "project");
              }}
              onSource={(entry) => {
                const view = renderViews.find(
                  (item) => item.path === entry.path,
                );
                if (view) activateView(view.id);
                else open(entry.path, entry.type);
              }}
              onAdd={(type) => {
                setDataType(type);
                setInput("");
                setDialog("open");
              }}
              onSave={() => {
                setProjectDestination(projectFile);
                setDialog("saveProject");
              }}
            />
            <div
              data-testid="pointcloud-classes"
              hidden={renderViewActive || !dataset || tab !== "edit"}
            >
              <div className="section-caption categories-heading">
                {t("点云类别")}{" "}
                <button
                  aria-label={t("管理标签集")}
                  onClick={() => {
                    runtime.current?.cancelActiveBrush?.();
                    setDialog("labels");
                  }}
                >
                  <Plus size={15} />
                </button>
              </div>
              <button
                className="label-set-summary"
                title={labelSet.name}
                onClick={() => {
                  runtime.current?.cancelActiveBrush?.();
                  setDialog("labels");
                }}
              >
                <Tags size={13} />
                <span>{labelSet.name}</span>
                <small>v{labelSet.version}</small>
              </button>
              <input
                className="class-search"
                aria-label={t("搜索点云类别")}
                placeholder={t("名称、别名或 ID")}
                value={classQuery}
                onChange={(e) => setClassQuery(e.target.value)}
              />
              <div className="class-list">
                {displayClasses
                  .filter((c) => matchesClass(c, classQuery))
                  .map((c) => (
                    <button
                      key={c.id}
                      title={[c.name, ...(c.aliases || [])].join(" / ")}
                      disabled={!!c.reserved}
                      className={category === c.id ? "active" : ""}
                      onClick={() => {
                        runtime.current?.cancelActiveBrush?.();
                        if (c.undefined) setDialog("labels");
                        else setCategory(c.id);
                      }}
                    >
                      <i style={{ background: c.color }} />
                      <span>
                        <strong>{c.name}</strong>
                        {c.aliases?.length > 0 && (
                          <em>{c.aliases.join(" / ")}</em>
                        )}
                        {c.undefined && <em>{t("未定义")}</em>}
                      </span>
                      <small>{c.id}</small>
                      {category === c.id && <Check size={13} />}
                    </button>
                  ))}
              </div>
              <div className="panel-foot">
                {t("目标类别用于下一次赋类操作")}
                <br />
                {t("原始分类作为基础值保留")}
              </div>
            </div>
            {renderViewActive && (
              <div className="info-note">
                {t(
                  activeResource?.type === "tiles"
                    ? "3D Tiles 按需加载，源数据保持不变。"
                    : "3DGS 使用独立编辑工具栏；各视图的编辑历史独立保存。",
                )}
              </div>
            )}
          </aside>
          <section className="viewport-section">
            <ViewTabs
              entries={[
                {
                  id: "pointcloud",
                  type: "pointcloud",
                  name: dataset?.metadata.name || t("主视图"),
                },
                ...renderViews.map((v) => ({ ...v, closable: true })),
              ]}
              activeId={activeView}
              onActivate={activateView}
              onClose={closeRenderView}
              t={t}
            />
            <div
              className="scene-view-pane"
              id="view-pane-pointcloud"
              role="tabpanel"
              aria-labelledby="view-tab-pointcloud"
              hidden={renderViewActive}
            >
              {dataset ? (
                <ExtensionWorkspace
                  component={PointCloudWorkspace}
                  active={!renderViewActive}
                  dataset={dataset}
                  runtime={runtime}
                  tool={tool}
                  setTool={(nextTool) => {
                    if (["brush", "rectangle", "polygon"].includes(nextTool)) {
                      setTab("edit");
                      setSelectionTool(nextTool);
                    }
                    setTool(nextTool);
                  }}
                  selection={selection}
                  setSelection={setSelection}
                  invert={invert}
                  workspace={workspace}
                  setWorkspace={setWorkspace}
                  onStats={setStats}
                  onError={fail}
                  mode={mode}
                  edl={edl}
                  pointSize={pointSize}
                  budget={budget}
                  operations={operations.slice(0, cursor)}
                  category={category}
                  classColor={
                    classes.find((c) => c.id === category)?.color || "#65d8cb"
                  }
                  onBrushStart={() => setMode("classification")}
                  onBrushCommit={(command) => history.commit(command)}
                  t={t}
                />
              ) : (
                <div className="viewport" data-testid="viewport">
                  <div className="welcome">
                    <div className="welcome-icon">
                      <Layers3 size={46} />
                    </div>
                    <small>SCENELOOM STUDIO</small>
                    <h1>{t("让空间数据，成为可探索的世界")}</h1>
                    <p>
                      {t("打开点云、3DGS、3D Tiles 或项目文件")}
                      <br />
                      {t("在同一项目中管理多份数据，按数据类型浏览与编辑。")}
                    </p>
                    <Button
                      icon={FolderOpen}
                      className="primary"
                      onClick={() => setDialog("open")}
                    >
                      {t("打开数据…")}
                    </Button>
                    <span>{t("本地处理 · 源数据保持不变")}</span>
                  </div>
                </div>
              )}
            </div>
            {renderViews.map((view) => (
              <div
                className="scene-view-pane"
                id={`view-pane-${view.id}`}
                key={view.id}
                role="tabpanel"
                aria-labelledby={`view-tab-${view.id}`}
                hidden={activeView !== view.id}
              >
                {visitedViews.includes(view.id) && (
                  <RenderResourceView
                    locale={locale}
                    resource={view}
                    active={activeView === view.id}
                    t={t}
                    onState={(data) =>
                      setRenderStats((prev) => ({ ...prev, [view.id]: data }))
                    }
                  />
                )}
              </div>
            ))}
            <LogPanel
              open={logOpen}
              onClose={() => setLogOpen(false)}
              t={t}
              locale={locale}
            />
          </section>
          <aside className="right-panel">
            <DockTabs
              entries={dockEntries}
              active={dockTab}
              t={t}
              onSelect={(id) => dispatchDock({ type: "select", id })}
              onClose={closeDock}
            />
            <div
              className="dock-pane"
              id="pane-properties"
              role="tabpanel"
              aria-labelledby="dock-properties"
              hidden={dockTab !== "properties"}
            >
              <div className="panel-title">
                <SlidersHorizontal size={15} />
                {t("属性")}
              </div>
              {renderViewActive && activeResource && (
                <>
                  <div className="property-heading">
                    {t(
                      activeResource.type === "tiles"
                        ? "3D Tiles 数据"
                        : "3DGS 数据",
                    )}
                  </div>
                  <dl>
                    <dt>{t("文件名")}</dt>
                    <dd className="project-path">{activeResource.name}</dd>
                    <dt>
                      {activeResource.type === "tiles"
                        ? t("已加载瓦片")
                        : "Gaussians"}
                    </dt>
                    <dd>
                      {format(
                        activeResource.type === "tiles"
                          ? renderStats[activeView]?.loaded || 0
                          : (renderStats[activeView]?.count ??
                              activeResource.count),
                      )}
                    </dd>
                    <dt>{t("文件大小")}</dt>
                    <dd>{(activeResource.bytes / 1048576).toFixed(1)} MB</dd>
                    <dt>{t("格式")}</dt>
                    <dd>{activeResource.encoding}</dd>
                    <dt>{t("源文件")}</dt>
                    <dd className="project-path" title={activeResource.path}>
                      {activeResource.path}
                    </dd>
                  </dl>
                  <div className="info-note">
                    {t(
                      activeResource.type === "tiles"
                        ? "相机自动保存在本机，源数据保持不变。"
                        : "显示设置和相机自动保存在本机，源 PLY 保持不变。",
                    )}
                  </div>
                </>
              )}
              <div hidden={renderViewActive}>
                <div className="property-heading">{t("数据概览")}</div>
                <dl>
                  <dt>{t("源点数")}</dt>
                  <dd>{dataset ? format(dataset.metadata.points) : "—"}</dd>
                  <dt>{t("当前显示")}</dt>
                  <dd data-testid="visible-points">{format(stats.visible)}</dd>
                  <dt>{t("可见节点")}</dt>
                  <dd>{stats.nodes || 0}</dd>
                  <dt>{t("待加载任务")}</dt>
                  <dd data-testid="loading-nodes">{stats.loading || 0}</dd>
                  <dt>{t("编辑操作")}</dt>
                  <dd data-testid="operation-count">{cursor}</dd>
                  <dt>{t("工程状态")}</dt>
                  <dd data-testid="save-state">
                    {dataset
                      ? saving
                        ? t("保存中")
                        : dirty
                          ? t("尚未保存")
                          : t("已保存")
                      : "—"}
                  </dd>
                  {dataset?.projectPath && (
                    <>
                      <dt>{t("工程文件")}</dt>
                      <dd className="project-path" title={dataset.projectPath}>
                        {dataset.projectPath}
                      </dd>
                    </>
                  )}
                </dl>
                <div className="info-note">
                  {t(
                    "选择区域后赋予类别或删除。可通过撤销和重做调整编辑结果。",
                  )}
                </div>
                <div className="property-heading">{t("操作记录")}</div>
                <ol className="history">
                  {operations.slice(0, cursor).map((op, i) => (
                    <li key={op.id}>
                      <span>{i + 1}</span>
                      {op.type === "segmentTrees"
                        ? t("CHM 单木分割")
                        : op.type === "createTree"
                          ? t("新建单木")
                          : op.type === "renameTree"
                            ? t("更新名称")
                            : op.type === "setAttribute"
                              ? t("单木归属编辑")
                              : op.type === "delete"
                                ? t("删除选区")
                                : t("赋予类别 {0}", { 0: op.category })}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            <div
              className="dock-pane"
              id="pane-tools"
              role="tabpanel"
              aria-labelledby="dock-tools"
              hidden={dockTab !== "tools"}
            >
              <Toolbox tools={tools} t={t} onRun={runRegisteredTool} />
            </div>
            <div
              className="dock-pane"
              id="pane-tasks"
              role="tabpanel"
              aria-labelledby="dock-tasks"
              hidden={dockTab !== "tasks"}
            >
              <TaskPanel
                tasks={taskManager.tasks}
                t={t}
                onCancel={(id) => taskManager.cancel(id).catch(fail)}
                onRefresh={() => taskManager.refresh().catch(fail)}
              />
            </div>
            {studioPlugins.map((plugin) => {
              const Panel = plugin.Panel;
              return (
                <div
                  key={plugin.id}
                  className="dock-pane"
                  id={"pane-" + plugin.id}
                  role="tabpanel"
                  aria-labelledby={"dock-" + plugin.id}
                  hidden={dockTab !== plugin.id}
                >
                  <Panel />
                </div>
              );
            })}
          </aside>
        </main>
        <footer>
          <span>
            <i className="status-dot" />
            {t(notice || "就绪")}
          </span>
          <span>
            {renderViewActive && activeResource
              ? activeResource.type === "tiles"
                ? `3D Tiles · ${renderStats[activeView]?.loaded || 0}`
                : `3DGS · ${format(renderStats[activeView]?.count || activeResource.count)} Gaussians`
              : dataset
                ? t("可见 {0} / {1} 点", {
                    0: format(stats.visible),
                    1: format(stats.source),
                  })
                : t("Web 工作台 · 开发预览")}
          </span>
          <button
            className="task-toggle"
            aria-expanded={rightOpen && dockTab === "tasks"}
            onClick={() => toggleDock("tasks")}
          >
            <ClipboardList size={13} />
            {t("任务")}
            {taskManager.running > 0 && <span>{taskManager.running}</span>}
          </button>
          <button
            className="log-toggle"
            aria-expanded={logOpen}
            title="Ctrl+J"
            onClick={() => setLogOpen(!logOpen)}
          >
            <FileText size={13} />
            {t("日志")}
          </button>
        </footer>
        {error && (
          <div role="alert" className="error">
            {t(error)}
            <button aria-label={t("关闭错误")} onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {closingGaussian && (
          <div className="modal-backdrop">
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-label={t("关闭 GS 视图")}
            >
              <h2>{t("关闭 GS 视图")}</h2>
              <p>{t("此视图有未保存的编辑。可取消关闭，然后保存 GS 工程。")}</p>
              <div className="modal-actions">
                <button onClick={() => setClosingGaussian(null)}>
                  {t("取消")}
                </button>
                <button onClick={() => closeRenderView(closingGaussian, true)}>
                  {t("放弃编辑并关闭")}
                </button>
              </div>
            </section>
          </div>
        )}
        {dialog && (
          <div className="modal-backdrop">
            <section
              role="dialog"
              aria-modal="true"
              className={
                "modal " + (dialog === "labels" ? "label-set-modal" : "")
              }
            >
              <div className="modal-title">
                <h2>
                  {
                    {
                      open: t("打开空间数据"),
                      saveProject: t("保存多数据项目"),
                      convert: t("转换并打开"),
                      settings: t("数据存储设置"),
                      category: t("新增点云类别"),
                      labels: t("分类标签集管理"),
                      tool: selectedTool
                        ? t(selectedTool.title)
                        : t("运行工具"),
                      package: t("打包工程"),
                    }[dialog]
                  }
                </h2>
                <button
                  aria-label={t("关闭对话框")}
                  onClick={() => setDialog(null)}
                >
                  <X size={19} />
                </button>
              </div>
              {dialog === "labels" && (
                <LabelSetDialog
                  current={labelSet}
                  observedIds={observedIds}
                  t={t}
                  onApply={(value) => {
                    runtime.current?.cancelActiveBrush?.();
                    setLabelSet(value);
                    if (
                      !value.classes.some(
                        (c) => c.id === category && !c.reserved,
                      )
                    )
                      setCategory(
                        value.classes.find((c) => !c.reserved)?.id ?? 0,
                      );
                    setClassQuery("");
                    setDialog(null);
                    setNotice("项目标签集已更新，点云 ID 保留");
                  }}
                />
              )}
              {dialog === "package" && (
                <PackageDialog
                  job={packageJob}
                  setJob={setPackageJob}
                  currentProject={dataset?.projectPath}
                  t={t}
                  onError={fail}
                  onPrepare={async (selected) => {
                    if (dataset && selected.includes(dataset.projectPath)) {
                      clearTimeout(timer.current);
                      await enqueue(
                        `/datasets/${dataset.id}/session`,
                        snapshot(),
                      );
                    }
                  }}
                />
              )}
              {dialog === "tool" && selectedTool && (
                <ToolDialog
                  tool={selectedTool}
                  t={t}
                  busy={busy}
                  setBusy={setBusy}
                  onError={fail}
                  onStarted={(result) => {
                    taskManager.track(result);
                    setDialog(null);
                    openDock("tasks");
                  }}
                />
              )}
              {dialog === "open" && (
                <OpenDataForm
                  type={dataType}
                  setType={setDataType}
                  input={input}
                  setInput={setInput}
                  busy={busy}
                  onOpen={() => open()}
                  onCancel={() => setDialog(null)}
                  onError={fail}
                  t={t}
                />
              )}
              {dialog === "saveProject" && (
                <>
                  <p>
                    {t(
                      "保存点云、3DGS 和 3D Tiles 的数据引用，重新打开项目可恢复数据列表。",
                    )}
                  </p>
                  <label>
                    {t("项目文件路径")}
                    <input
                      autoFocus
                      aria-label={t("项目文件路径")}
                      placeholder="workspace.sceneloom.json"
                      value={projectDestination}
                      onChange={(event) =>
                        setProjectDestination(event.target.value)
                      }
                    />
                  </label>
                  {desktop && (
                    <button
                      disabled={busy}
                      onClick={async () => {
                        try {
                          const destination = await pickProjectDestination();
                          if (destination) setProjectDestination(destination);
                        } catch (error) {
                          fail(error);
                        }
                      }}
                    >
                      {t("选择保存位置")}
                    </button>
                  )}
                  <small>
                    {t(
                      "项目保存数据引用；源数据和各数据集的编辑工程需一同保留。",
                    )}
                  </small>
                  <div className="modal-actions">
                    <button disabled={busy} onClick={() => setDialog(null)}>
                      {t("取消")}
                    </button>
                    <button
                      className="primary"
                      disabled={busy || !projectDestination.trim()}
                      onClick={saveDataProject}
                    >
                      {t("保存")}
                    </button>
                  </div>
                </>
              )}
              {dialog === "convert" && (
                <>
                  <p>
                    {t("此文件需要转换为 Potree 八叉树，才能按需加载与编辑。")}
                  </p>
                  <dl className="conversion-details">
                    <dt>{t("源文件")}</dt>
                    <dd>{conversion.source}</dd>
                    <dt>{t("文件大小")}</dt>
                    <dd>{(conversion.bytes / 1024 ** 3).toFixed(2)} GB</dd>
                    <dt>{t("转换数据位置")}</dt>
                    <dd>{conversion.output}</dd>
                  </dl>
                  <p className="info-note">
                    {t(
                      "无需再次选择位置。转换数据和临时分块会额外占用磁盘空间，原文件保留。",
                    )}
                  </p>
                  <div className="modal-actions">
                    <button onClick={() => setDialog("settings")}>
                      {t("存储设置")}
                    </button>
                    <button onClick={() => setDialog(null)}>{t("取消")}</button>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={startConversion}
                    >
                      {t("转换并打开")}
                    </button>
                  </div>
                </>
              )}
              {dialog === "settings" && (
                <>
                  <label>
                    {t("转换结果存储")}
                    <select
                      aria-label={t("转换结果存储")}
                      value={settings.storageMode}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          storageMode: e.target.value,
                        })
                      }
                    >
                      <option value="adjacent">
                        {t("源文件旁的 .sceneloom 目录")}
                      </option>
                      <option value="custom">{t("统一数据目录")}</option>
                    </select>
                  </label>
                  {settings.storageMode === "custom" && (
                    <label>
                      {t("统一数据目录")}
                      <input
                        aria-label={t("统一数据目录")}
                        value={settings.dataDirectory}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            dataDirectory: e.target.value,
                          })
                        }
                      />
                    </label>
                  )}
                  <p>{t("修改仅影响新的转换，已有资产仍按原关联位置加载。")}</p>
                  <div className="modal-actions">
                    <button
                      className="primary"
                      onClick={() =>
                        api("/settings", settings)
                          .then(() => {
                            setDialog(null);
                            setNotice("存储设置已保存");
                          })
                          .catch(fail)
                      }
                    >
                      {t("保存设置")}
                    </button>
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </StudioPlugins>
  );
}
createRoot(document.getElementById("root")).render(<App />);
