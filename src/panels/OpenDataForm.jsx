import React, { useState } from "react";
import { dataTypes } from "../../shared/data-types.mjs";
import { desktop, pickLocalData } from "../desktop.js";
import { DirectoryPicker } from "./DirectoryPicker.jsx";

export function OpenDataForm({
  type,
  setType,
  input,
  setInput,
  busy,
  onOpen,
  onCancel,
  onError,
  t,
}) {
  const selected = dataTypes.find((item) => item.id === type);
  const [picker, setPicker] = useState(null);
  async function choose(directory) {
    if (!desktop) {
      setPicker(directory ? "directory" : "file");
      return;
    }
    try {
      const value = await pickLocalData(directory, type, t);
      if (value) setInput(value);
    } catch (error) {
      onError(error);
    }
  }
  return (
    <>
      <label>
        {t("数据类型")}
        <select
          aria-label={t("数据类型")}
          value={type}
          disabled={busy || !!picker}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="auto">{t("自动识别")}</option>
          {dataTypes.map((item) => (
            <option key={item.id} value={item.id}>
              {t(item.label)}
            </option>
          ))}
        </select>
      </label>
      <div className="supported-data-types">
        {(selected ? [selected] : dataTypes).map((item) => (
          <div key={item.id}>
            <strong>{t(item.label)}</strong>
            <span>{t(item.formats)}</span>
          </div>
        ))}
      </div>
      <label>
        {t("数据路径")}
        <input
          autoFocus
          aria-label={t("数据路径")}
          placeholder={t("输入文件或数据目录的完整路径")}
          value={input}
          disabled={busy || !!picker}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !busy && input.trim()) onOpen();
          }}
        />
      </label>
      <div className="data-picker-actions">
        <button disabled={busy || !!picker} onClick={() => choose(false)}>
          {t("选择文件")}
        </button>
        {type !== "project" && type !== "gaussian" && (
          <button disabled={busy || !!picker} onClick={() => choose(true)}>
            {t("选择数据目录")}
          </button>
        )}
      </div>
      {picker && (
        <DirectoryPicker
          initialPath={input.trim().replace(/^"|"$/g, "")}
          mode={picker}
          dataType={type}
          t={t}
          onSelect={(value) => {
            setInput(value);
            setPicker(null);
          }}
          onCancel={() => setPicker(null)}
          onError={onError}
        />
      )}
      {!picker && (
        <div className="modal-actions">
          <button disabled={busy} onClick={onCancel}>
            {t("取消")}
          </button>
          <button
            className="primary"
            disabled={busy || !input.trim()}
            onClick={() => onOpen()}
          >
            {busy ? t("检查中…") : t("打开")}
          </button>
        </div>
      )}
    </>
  );
}
