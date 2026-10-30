import React, { useState, useEffect } from "react";
import { api } from "../api.js";
import { FileText, Folder } from "lucide-react";
export function DirectoryPicker({
  initialPath,
  mode = "directory",
  dataType = "auto",
  t,
  onSelect,
  onCancel,
  onError,
}) {
  const [value, setValue] = useState({ path: "", directories: [], files: [] }),
    [loading, setLoading] = useState(false),
    [selectedFile, setSelectedFile] = useState(""),
    [error, setError] = useState("");
  const fileMode = mode === "file";
  async function load(directory) {
    setLoading(true);
    setError("");
    setSelectedFile("");
    try {
      setValue(
        await api("/directories", {
          path: directory,
          includeFiles: fileMode,
          type: dataType,
        }),
      );
    } catch (error) {
      setError(error.message);
      onError(error);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load(initialPath || "");
  }, []);
  return (
    <section
      className="directory-picker"
      aria-label={t(fileMode ? "选择文件" : "选择目录")}
    >
      <strong>{t(fileMode ? "选择文件" : "选择目录")}</strong>
      <div className="package-path-row">
        <button disabled={loading} onClick={() => load("")}>
          {t("磁盘")}
        </button>
        <button
          disabled={loading || !value.parent}
          onClick={() => load(value.parent)}
        >
          {t("上级目录")}
        </button>
        <span>{value.path || t("磁盘")}</span>
      </div>
      {error && <p role="alert">{t(error)}</p>}
      <div className="directory-list" aria-busy={loading}>
        {value.directories.map((item) => (
          <button
            key={item.path}
            disabled={loading}
            onClick={() => load(item.path)}
          >
            <Folder size={14} />
            <span>{item.name}</span>
          </button>
        ))}
        {fileMode &&
          value.files?.map((item) => (
            <button
              key={item.path}
              disabled={loading}
              className={selectedFile === item.path ? "selected" : ""}
              aria-pressed={selectedFile === item.path}
              onClick={() => setSelectedFile(item.path)}
              onDoubleClick={() => onSelect(item.path)}
            >
              <FileText size={14} />
              <span>{item.name}</span>
            </button>
          ))}
        {fileMode &&
          value.path &&
          !loading &&
          !error &&
          !value.files?.length && <p>{t("此目录没有匹配类型的文件")}</p>}
      </div>
      <div className="modal-actions">
        <button onClick={onCancel}>{t("取消")}</button>
        <button
          disabled={
            loading || !!error || !(fileMode ? selectedFile : value.path)
          }
          onClick={() => onSelect(fileMode ? selectedFile : value.path)}
        >
          {t(fileMode ? "选择此文件" : "选择此目录")}
        </button>
      </div>
    </section>
  );
}
