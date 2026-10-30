import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../../api.js";
import {
  TreePine,
  ListTree,
  Scan,
  MousePointer2,
  BoxSelect,
  Lasso,
  Paintbrush,
} from "lucide-react";
import { RibbonButton } from "../../components/Ribbon.jsx";
import { EditAdapterContext } from "../context.jsx";
import { useChm, ChmPanel } from "./chm.jsx";
import {
  forestryState,
  TREE_FIELD,
  treeColor,
} from "../../../shared/forestry.mjs";
const Context = createContext(null);
function Provider({ host, children }) {
  const {
    dataset,
    operations,
    cursor,
    selection,
    workspace,
    history,
    t,
    runtime,
  } = host;
  const [active, setActive] = useState(0),
    [policy, setPolicy] = useState("unassigned"),
    [remove, setRemove] = useState(false),
    [valueType, setValueType] = useState("uint16"),
    [loading, setLoading] = useState(false);
  const latest = useRef(host);
  latest.current = host;
  const state = useMemo(() => {
    try {
      return forestryState(operations.slice(0, cursor), dataset?.metadata);
    } catch (error) {
      return { field: null, trees: [], error: error.message };
    }
  }, [operations, cursor, dataset]);
  const current = state.trees.find((tree) => tree.id === active);
  const chm = useChm(host, state.field, valueType, policy);
  useEffect(() => {
    setActive(0);
    setRemove(false);
  }, [dataset?.id]);
  useEffect(() => {
    if (active && !current) setActive(0);
  }, [active, current]);
  useEffect(() => {
    runtime.current?.setActiveTree(current?.id || 0);
  }, [current?.id, dataset?.id]);
  useEffect(() => {
    runtime.current?.cancelActiveBrush?.();
    if (host.tab === "forestry") host.setMode("tree");
    return () => {
      if (host.tab === "forestry") host.setMode("classification");
    };
  }, [host.tab]);
  const changeTarget = (id) => {
    host.activate();
    runtime.current?.cancelActiveBrush?.();
    setActive(id);
    setRemove(false);
  };
  async function create() {
    if (!dataset || loading) return;
    host.activate();
    runtime.current?.cancelActiveBrush?.();
    setLoading(true);
    const owner = dataset.id,
      captured = selection
        ? {
            selection,
            scope: workspace.region || null,
            invert: host.invert,
            policy,
          }
        : {};
    try {
      const type = state.field?.valueType || valueType;
      const { treeId } = await api("/datasets/" + owner + "/tree-id", {
        valueType: type,
      });
      if (latest.current.dataset?.id !== owner) return;
      latest.current.history.commit({
        id: crypto.randomUUID(),
        payloadVersion: 2,
        type: "createTree",
        treeId,
        valueType: type,
        name: t("单木 {0}", { 0: treeId }),
        ...captured,
      });
      setActive(treeId);
      setRemove(false);
      host.setSelection(null);
      host.setMode("tree");
      host.openPanel();
    } catch (error) {
      host.onError(error);
    } finally {
      setLoading(false);
    }
  }
  function assign(removing = false) {
    if (!current || !selection) return;
    host.activate();
    runtime.current?.cancelActiveBrush?.();
    history.commit({
      id: crypto.randomUUID(),
      payloadVersion: 2,
      type: "setAttribute",
      fieldId: TREE_FIELD,
      treeId: current.id,
      value: removing ? 0 : current.id,
      policy: removing ? "remove" : policy,
      selection,
      scope: workspace.region || null,
      invert: host.invert,
    });
    host.setSelection(null);
    host.setMode("tree");
  }
  const adapter = useMemo(
    () => ({
      brushLabel: "单木画刷",
      color: current ? treeColor(current.id) : "#88929f",
      onBrushStart: () => host.setMode("tree"),
      brushAction: current
        ? {
            payloadVersion: 2,
            type: "setAttribute",
            fieldId: TREE_FIELD,
            treeId: current.id,
            value: remove ? 0 : current.id,
            policy: remove ? "remove" : policy,
          }
        : null,
    }),
    [current?.id, remove, policy],
  );
  const inherited = useContext(EditAdapterContext);
  return (
    <Context.Provider
      value={{
        ...host,
        ...state,
        current,
        policy,
        setPolicy,
        remove,
        setRemove,
        valueType,
        setValueType,
        loading,
        create,
        assign,
        changeTarget,
        chm,
      }}
    >
      <EditAdapterContext.Provider
        value={host.tab === "forestry" ? adapter : inherited}
      >
        {children}
      </EditAdapterContext.Provider>
    </Context.Provider>
  );
}
function Ribbon() {
  const h = useContext(Context),
    { t } = h;
  return (
    <>
      <div className="ribbon-group">
        <div className="ribbon-actions">
          <RibbonButton
            large
            icon={TreePine}
            disabled={!h.dataset || h.loading || !!h.error}
            onClick={h.create}
          >
            {t(h.selection ? "选区新建单木" : "新建单木")}
          </RibbonButton>
          <div className="ribbon-stack">
            <RibbonButton icon={ListTree} onClick={h.openPanel}>
              {t("单木管理")}
            </RibbonButton>
            <RibbonButton
              icon={Scan}
              disabled={!h.dataset}
              onClick={() => {
                h.openPanel();
                h.chm.setOpen(true);
              }}
            >
              {t("CHM 单木分割")}
            </RibbonButton>
          </div>
        </div>
      </div>
      <div className="ribbon-group">
        <div className="ribbon-actions">
          {[
            ["navigate", "浏览", MousePointer2],
            ["rectangle", "矩形", BoxSelect],
            ["polygon", "多边形", Lasso],
            ["brush", "单木画刷", Paintbrush],
          ].map(([tool, label, icon]) => (
            <RibbonButton
              large
              icon={icon}
              key={tool}
              disabled={!h.dataset || (tool === "brush" && !h.current)}
              className={h.tool === tool ? "selected" : ""}
              onClick={() => h.setTool(tool)}
            >
              {t(label)}
            </RibbonButton>
          ))}
        </div>
      </div>
      <div className="ribbon-group">
        <div className="ribbon-actions">
          <button
            disabled={!h.current || !h.selection}
            onClick={() => h.assign()}
          >
            {t("归入当前单木")}
          </button>
          <button
            disabled={!h.current || !h.selection}
            onClick={() => h.assign(true)}
          >
            {t("从当前单木移除")}
          </button>
          <button
            disabled={!h.cursor}
            onClick={() => {
              h.runtime.current?.cancelActiveBrush?.();
              h.history.undo();
            }}
          >
            {t("撤销")}
          </button>
          <button
            disabled={h.cursor === h.operations.length}
            onClick={() => {
              h.runtime.current?.cancelActiveBrush?.();
              h.history.redo();
            }}
          >
            {t("重做")}
          </button>
        </div>
      </div>
    </>
  );
}
function Panel() {
  const h = useContext(Context),
    { t } = h;
  return (
    <div className="forestry-panel">
      <h3>{t("人工单木编辑")}</h3>
      <ChmPanel h={h} />
      {h.error && <p role="alert">{t(h.error)}</p>}
      <button
        disabled={!h.dataset || h.loading || !!h.error}
        onClick={h.create}
      >
        {t(h.selection ? "选区新建单木" : "新建单木")}
      </button>
      {!h.field && (
        <label>
          {t("编号类型")}
          <select
            aria-label={t("编号类型")}
            value={h.valueType}
            onChange={(e) => h.setValueType(e.target.value)}
          >
            <option value="uint16">uint16 · 1–65535</option>
            <option value="uint32">uint32 · 1–4294967295</option>
          </select>
        </label>
      )}
      {h.field && <p>treeID · {h.field.valueType}</p>}
      <label>
        {t("归属策略")}
        <select
          aria-label={t("归属策略")}
          value={h.policy}
          onChange={(e) => {
            h.runtime.current?.cancelActiveBrush?.();
            h.setPolicy(e.target.value);
          }}
        >
          <option value="unassigned">{t("仅未分配点")}</option>
          <option value="replace">{t("转入当前单木")}</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={h.remove}
          onChange={(e) => {
            h.runtime.current?.cancelActiveBrush?.();
            h.setRemove(e.target.checked);
          }}
        />
        {t("画刷从当前单木移除")}
      </label>
      <div role="list" aria-label={t("单木列表")} className="tree-list">
        {h.trees.map((tree) => (
          <button
            role="listitem"
            aria-pressed={h.current?.id === tree.id}
            key={tree.id}
            onClick={() => h.changeTarget(tree.id)}
          >
            <i style={{ background: tree.color }} />
            {tree.name}
            <small>#{tree.id}</small>
          </button>
        ))}
      </div>
      {h.current && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = new FormData(e.currentTarget).get("name").trim();
            if (name && name !== h.current.name)
              h.history.commit({
                id: crypto.randomUUID(),
                payloadVersion: 2,
                type: "renameTree",
                treeId: h.current.id,
                name,
              });
          }}
          key={h.current.id + ":" + h.current.name}
        >
          <label>
            {t("单木名称")}
            <input
              name="name"
              aria-label={t("单木名称")}
              defaultValue={h.current.name}
              maxLength="120"
              required
            />
          </label>
          <button>{t("更新名称")}</button>
        </form>
      )}
      <p>
        {h.current
          ? t("当前单木：{0}", { 0: h.current.name })
          : t("请新建或选择单木")}
      </p>
      <p>{t("移除只清除单木归属，不删除点。")}</p>
      <p>{t("单木与分类独立；未加载点会应用相同编辑。")}</p>
    </div>
  );
}
export default {
  id: "forestry",
  label: "林业",
  Provider,
  Ribbon,
  Panel,
  panelLabel: "单木",
  displayModes: [{ id: "tree", label: "单木" }],
};
