import React, { useEffect, useRef, useState } from "react";
import { FileText, X, Download, Search, Pause, Play } from "lucide-react";
import { api } from "../api.js";
export function LogPanel({ open, onClose, t, locale }) {
  const [entries, setEntries] = useState([]),
    [level, setLevel] = useState(""),
    [search, setSearch] = useState(""),
    [paused, setPaused] = useState(false),
    [error, setError] = useState(""),
    [directory, setDirectory] = useState("");
  const cursor = useRef(0);
  useEffect(() => {
    if (!open || paused) return;
    let active = true,
      busy = false;
    cursor.current = 0;
    setEntries([]);
    async function poll() {
      if (busy) return;
      busy = true;
      try {
        const result = await api(
          `/logs?after=${cursor.current}&level=${encodeURIComponent(level)}&search=${encodeURIComponent(search)}`,
        );
        if (!active) return;
        cursor.current = result.cursor;
        setDirectory(result.directory);
        setError("");
        setEntries((old) => [...old, ...result.entries].slice(-1000));
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        busy = false;
      }
    }
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open, level, search, paused]);
  if (!open) return null;
  return (
    <section className="log-panel" aria-label={t("日志面板")}>
      <div className="log-toolbar">
        <strong>
          <FileText size={14} />
          {t("日志")}
        </strong>
        <select
          aria-label={t("日志级别")}
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          <option value="">{t("全部级别")}</option>
          <option value="info">{t("信息")}</option>
          <option value="warn">{t("警告")}</option>
          <option value="error">{t("错误")}</option>
        </select>
        <label className="log-search">
          <Search size={13} />
          <input
            aria-label={t("搜索日志")}
            placeholder={t("搜索日志")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button
          title={t(paused ? "继续刷新" : "暂停刷新")}
          aria-label={t(paused ? "继续刷新" : "暂停刷新")}
          onClick={() => setPaused(!paused)}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
        <a
          href="/api/logs/export"
          download
          title={t("导出日志")}
          aria-label={t("导出日志")}
        >
          <Download size={14} />
        </a>
        <button
          title={t("关闭日志面板")}
          aria-label={t("关闭日志面板")}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>
      <div className="log-entries" role="log" aria-live="off">
        {error && (
          <p>
            {t("日志读取失败")}：{error}
          </p>
        )}
        {!entries.length && !error && (
          <p className="drawer-empty">{t("暂无匹配日志")}</p>
        )}
        {entries.map((entry) => (
          <details key={entry.id} className={`log-entry ${entry.level}`}>
            <summary>
              <time dateTime={entry.time}>
                {new Date(entry.time).toLocaleTimeString(locale, {
                  hour12: false,
                })}
              </time>
              <b>{entry.level.toUpperCase()}</b>
              <span className="log-source">{entry.source}</span>
              <span className="log-message">{t(entry.message)}</span>
            </summary>
            {Object.keys(entry.context || {}).length > 0 && (
              <pre>{JSON.stringify(entry.context, null, 2)}</pre>
            )}
          </details>
        ))}
      </div>
      <div className="log-location" title={directory}>
        {t("日志目录")}：{directory}
      </div>
    </section>
  );
}
