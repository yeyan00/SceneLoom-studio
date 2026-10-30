import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import {
  LAS_LABEL_SET_ID,
  matchesClass,
  semanticLabels,
  validateClasses,
  validateLabelSet,
} from "../../shared/label-sets.mjs";

export function LabelSetDialog({ current, observedIds = [], onApply, t }) {
  const [library, setLibrary] = useState([]),
    [draft, setDraft] = useState(() => structuredClone(current)),
    [entry, setEntry] = useState(null),
    [oldId, setOldId] = useState(null),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const baseline = useRef(structuredClone(current)),
    file = useRef(null);
  const readOnly = draft.id === LAS_LABEL_SET_ID;
  const unknown = observedIds.filter(
    (id) => !draft.classes.some((c) => c.id === id),
  );
  useEffect(() => {
    let active = true;
    api("/label-sets")
      .then((r) => {
        if (active) setLibrary(r.labelSets);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  function choose(set) {
    const copy = structuredClone(set);
    baseline.current = copy;
    setDraft(copy);
    setEntry(null);
    setError("");
    setNotice("");
    setQuery("");
  }
  function mutate(next) {
    setDraft({
      ...next,
      version:
        baseline.current.id === next.id
          ? baseline.current.version + 1
          : next.version,
    });
    setNotice("");
  }
  function create(copy = false) {
    choose({
      id: crypto.randomUUID(),
      name: copy ? draft.name + " · " + t("副本") : t("新标签集"),
      version: 1,
      classes: copy ? structuredClone(draft.classes) : [],
    });
  }
  function edit(c) {
    setOldId(c?.id ?? null);
    setEntry(
      c
        ? structuredClone(c)
        : {
            id:
              Array.from({ length: 256 }, (_, i) => i).find(
                (id) => !draft.classes.some((c) => c.id === id),
              ) ?? 0,
            name: "",
            aliases: [],
            color: "#b380e6",
            semantic: "none",
          },
    );
    setError("");
  }
  function saveClass(e) {
    e.preventDefault();
    try {
      const data = new FormData(e.currentTarget),
        item = {
          id: Number(data.get("classId")),
          name: String(data.get("className")).trim(),
          aliases: [
            ...new Set(
              String(data.get("aliases"))
                .split(/[,，;；\n]/)
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          ],
          color: data.get("color"),
          semantic: data.get("semantic"),
          ...(data.get("reserved") ? { reserved: true } : {}),
        };
      const classes = [
        ...draft.classes.filter((c) => c.id !== oldId),
        item,
      ].sort((a, b) => a.id - b.id);
      validateClasses(classes);
      mutate({ ...draft, classes });
      setEntry(null);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  function checked() {
    validateLabelSet(draft);
    if (entry && !readOnly) throw new Error("请先保存或取消类别编辑");
    return structuredClone(draft);
  }
  async function saveTemplate() {
    setBusy(true);
    setError("");
    try {
      const value = checked();
      const result = await api("/label-sets", {
        action: "save",
        labelSet: value,
        expectedVersion: library.find((s) => s.id === value.id)?.version || 0,
      });
      setLibrary(result.labelSets);
      choose(result.labelSet);
      setNotice("标签集已保存到本机标签库");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteTemplate() {
    setBusy(true);
    setError("");
    try {
      const result = await api("/label-sets", {
        action: "delete",
        id: draft.id,
        expectedVersion: library.find((s) => s.id === draft.id)?.version || 0,
      });
      setLibrary(result.labelSets);
      setNotice("模板已删除，工程副本保留");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function exportSet() {
    try {
      const value = checked(),
        url = URL.createObjectURL(
          new Blob(
            [
              JSON.stringify(
                { format: "SceneLoomLabelSet", version: 1, labelSet: value },
                null,
                2,
              ),
            ],
            { type: "application/json" },
          ),
        );
      const a = document.createElement("a");
      a.href = url;
      a.download = "labels-" + value.id + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e.message);
    }
  }
  async function importSet(e) {
    try {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 1024 * 1024) throw new Error("标签集文件过大");
      const value = JSON.parse(await f.text());
      if (value.format !== "SceneLoomLabelSet" || value.version !== 1)
        throw new Error("标签集文件格式无效");
      validateLabelSet(value.labelSet);
      choose(value.labelSet);
      setNotice("已导入草稿，确认后应用到工程");
    } catch (e) {
      setError(e.message);
    } finally {
      e.target.value = "";
    }
  }
  return (
    <div className="label-manager">
      <aside className="label-library" aria-label={t("标签集列表")}>
        <div className="label-library-actions">
          <button onClick={() => create()} disabled={busy}>
            {t("新建标签集")}
          </button>
          <button onClick={() => create(true)} disabled={busy}>
            {t("复制标签集")}
          </button>
        </div>
        <small>{t("当前工程副本")}</small>
        <button
          className="label-template"
          disabled={busy}
          onClick={() => choose(current)}
          title={current.name}
        >
          <strong>{current.name}</strong>
          <span>
            v{current.version} · {t("工程副本")}
          </span>
        </button>
        <small>{t("本机标签库")}</small>
        <div className="label-template-list">
          {library.map((s) => (
            <button
              key={s.id}
              disabled={busy}
              className={
                "label-template " + (draft.id === s.id ? "active" : "")
              }
              onClick={() => choose(s)}
              title={s.name}
            >
              <strong>{s.name}</strong>
              <span>
                {s.id === LAS_LABEL_SET_ID ? t("内置标准") : t("自定义")} · v
                {s.version} · {s.classes.length}
              </span>
            </button>
          ))}
        </div>
        <div className="label-library-actions">
          <button onClick={() => file.current.click()} disabled={busy}>
            {t("导入 JSON")}
          </button>
          <button onClick={exportSet} disabled={busy}>
            {t("导出 JSON")}
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          aria-label={t("导入标签集文件")}
          hidden
          onChange={importSet}
        />
      </aside>
      <div className="label-editor">
        <label>
          {t("标签集名称")}
          <input
            aria-label={t("标签集名称")}
            value={draft.name}
            maxLength={120}
            disabled={readOnly || busy}
            onChange={(e) => mutate({ ...draft, name: e.target.value })}
          />
        </label>
        <p className="label-help">
          {t("标签定义不改写点云 ID；工程保存独立副本。")}
        </p>
        {readOnly && (
          <p className="label-help">{t("内置标签集只读，请先复制")}</p>
        )}
        {draft.standard && <p className="label-standard">{draft.standard}</p>}
        <div className="label-class-toolbar">
          <input
            aria-label={t("搜索类别名称、别名或 ID")}
            placeholder={t("搜索类别名称、别名或 ID")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            disabled={readOnly || busy || draft.classes.length >= 256}
            onClick={() => edit(null)}
          >
            {t("新增类别")}
          </button>
        </div>
        {unknown.length > 0 && (
          <p className="label-help" role="status">
            {t("已观测到未定义 ID：{0}", { 0: unknown.join(", ") })}{" "}
            {t("原始数值保留，可新增对应定义。")}
          </p>
        )}
        <div className={"label-class-workspace " + (entry ? "editing" : "")}>
          <div
            className="label-rows"
            role="list"
            aria-label={t("类别定义列表")}
          >
            {draft.classes
              .filter((c) => matchesClass(c, query))
              .map((c) => (
                <button
                  type="button"
                  role="listitem"
                  aria-label={`${c.id} ${c.name}`}
                  className={
                    "label-row " + (entry && oldId === c.id ? "active" : "")
                  }
                  key={c.id}
                  onClick={() => edit(c)}
                >
                  <i style={{ background: c.color }} />
                  <b>{c.id}</b>
                  <span>
                    <strong>{c.name}</strong>
                    <small>{(c.aliases || []).join(" / ") || "—"}</small>
                  </span>
                  <em>
                    {t(
                      c.reserved
                        ? "保留类别"
                        : semanticLabels[c.semantic || "none"],
                    )}
                  </em>
                </button>
              ))}
            {!draft.classes.length && (
              <p className="label-help">
                {t("请新增至少一个类别，再应用标签集。")}
              </p>
            )}
          </div>
          {entry && (
            <form
              className="label-entry"
              onSubmit={saveClass}
              key={`${draft.id}:${oldId}`}
            >
              <fieldset disabled={readOnly || busy}>
                <div className="label-entry-pair">
                  <label>
                    {t("类别 ID")}
                    <input
                      name="classId"
                      aria-label={t("类别 ID")}
                      type="number"
                      min={0}
                      max={255}
                      required
                      defaultValue={entry.id}
                    />
                  </label>
                  <label>
                    {t("颜色")}
                    <input
                      name="color"
                      aria-label={t("类别颜色")}
                      type="color"
                      defaultValue={entry.color}
                    />
                  </label>
                </div>
                <label>
                  {t("正式名称")}
                  <input
                    name="className"
                    aria-label={t("正式名称")}
                    required
                    maxLength={120}
                    defaultValue={entry.name}
                  />
                </label>
                <label>
                  {t("别名")}
                  <textarea
                    name="aliases"
                    aria-label={t("别名")}
                    rows={3}
                    defaultValue={(entry.aliases || []).join("\n")}
                    placeholder={t("每行一个，或使用逗号分隔")}
                  />
                </label>
                <label>
                  {t("算法语义")}
                  <select
                    name="semantic"
                    aria-label={t("算法语义")}
                    defaultValue={entry.semantic || "none"}
                  >
                    {Object.entries(semanticLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {t(label)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="label-help">
                  {t("供工具识别地面、建筑等含义；不根据名称猜测。")}
                </p>
                <label className="label-checkbox">
                  <input
                    type="checkbox"
                    name="reserved"
                    defaultChecked={!!entry.reserved}
                  />
                  {t("保留类别（不可赋类）")}
                </label>
                <button type="submit">{t("保存类别定义")}</button>
                {oldId !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      mutate({
                        ...draft,
                        classes: draft.classes.filter((c) => c.id !== oldId),
                      });
                      setEntry(null);
                    }}
                  >
                    {t("移除类别定义")}
                  </button>
                )}
              </fieldset>
              <button type="button" onClick={() => setEntry(null)}>
                {t("关闭类别编辑")}
              </button>
            </form>
          )}
        </div>
        {error && (
          <p role="alert" className="label-error">
            {t(error)}
          </p>
        )}
        {notice && (
          <p role="status" className="label-help">
            {t(notice)}
          </p>
        )}
        <div className="label-manager-actions">
          <button disabled={busy || readOnly} onClick={saveTemplate}>
            {t("保存到标签库")}
          </button>
          <button
            disabled={
              busy || readOnly || !library.some((s) => s.id === draft.id)
            }
            onClick={deleteTemplate}
          >
            {t("删除库中模板")}
          </button>
          <button
            className="primary"
            disabled={busy || !draft.classes.some((c) => !c.reserved)}
            onClick={() => {
              try {
                onApply(checked());
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            {t("应用到当前工程")}
          </button>
        </div>
      </div>
    </div>
  );
}
