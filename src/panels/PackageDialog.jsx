import React, { useState, useEffect } from "react";
import { api } from "../api.js";
import { DirectoryPicker } from "./DirectoryPicker.jsx";
const active = ["queued", "preparing", "running", "cancelling"];
const labels = {
  queued: "等待中",
  preparing: "准备中",
  running: "打包中",
  copying: "复制中",
  succeeded: "已完成",
  skipped: "已跳过",
  failed: "失败",
  cancelled: "已取消",
  cancelling: "取消中",
  completedWithErrors: "部分失败",
};
export function PackageDialog({
  currentProject,
  t,
  onPrepare,
  onError,
  job,
  setJob,
}) {
  const [directory, setDirectory] = useState(""),
    [destination, setDestination] = useState(""),
    [projects, setProjects] = useState(
      currentProject ? [{ path: currentProject, name: t("当前工程") }] : [],
    ),
    [selected, setSelected] = useState(currentProject ? [currentProject] : []),
    [includeOriginal, setIncludeOriginal] = useState(false),
    [collision, setCollision] = useState("rename"),
    [loading, setLoading] = useState(false),
    [truncated, setTruncated] = useState(false);
  const running = job && active.includes(job.status);
  const [picker, setPicker] = useState(null);
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    const timer = setInterval(
      () =>
        api("/packages/" + job.id)
          .then((value) => {
            if (!stopped) setJob(value);
          })
          .catch(onError),
      400,
    );
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [job?.id, running]);
  async function scan() {
    setLoading(true);
    try {
      const result = await api("/projects/scan", { directory });
      setProjects((previous) => [
        ...new Map(
          [...previous, ...result.projects].map((project) => [
            project.path,
            project,
          ]),
        ).values(),
      ]);
      setTruncated(result.truncated);
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }
  async function start() {
    setLoading(true);
    try {
      await onPrepare(selected);
      setJob(
        await api("/packages", {
          projects: selected,
          destination,
          includeOriginal,
          collision,
        }),
      );
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }
  const toggle = (project) =>
    setSelected((previous) =>
      previous.includes(project)
        ? previous.filter((item) => item !== project)
        : [...previous, project],
    );
  const percent = job?.totalBytes
    ? Math.min(100, (job.completedBytes / job.totalBytes) * 100)
    : 0;
  return (
    <div className="package-dialog">
      <p>{t("选择一个或多个工程，复制为可独立打开的完整工程目录。")}</p>
      <label>
        {t("扫描工程目录")}
        <div className="package-path-row">
          <input
            aria-label={t("扫描工程目录")}
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            disabled={running}
          />
          <button
            aria-label={t("浏览扫描目录")}
            disabled={running}
            onClick={() => setPicker("scan")}
          >
            {t("浏览目录")}
          </button>
          <button
            disabled={running || loading || !directory.trim()}
            onClick={scan}
          >
            {t("扫描")}
          </button>
        </div>
      </label>
      {truncated && <p>{t("目录较大，请缩小扫描范围以查看全部工程。")}</p>}
      <div className="package-selection-actions">
        <button
          disabled={running}
          onClick={() => setSelected(projects.map((project) => project.path))}
        >
          {t("全选")}
        </button>
        <button disabled={running} onClick={() => setSelected([])}>
          {t("清空选择")}
        </button>
        <span>{t("已选择 {0} 个工程", { 0: selected.length })}</span>
      </div>
      <div className="package-project-list">
        {projects.length ? (
          projects.map((project) => (
            <label key={project.path}>
              <input
                type="checkbox"
                checked={selected.includes(project.path)}
                onChange={() => toggle(project.path)}
                disabled={running}
              />
              <span>
                {project.name}
                <small title={project.path}>{project.path}</small>
              </span>
            </label>
          ))
        ) : (
          <p>{t("请扫描目录以添加工程。")}</p>
        )}
      </div>
      <label>
        {t("目标目录")}
        <div className="package-path-row">
          <input
            aria-label={t("目标目录")}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            disabled={running}
          />
          <button
            aria-label={t("浏览目标目录")}
            disabled={running}
            onClick={() => setPicker("destination")}
          >
            {t("浏览目录")}
          </button>
        </div>
      </label>
      {picker && (
        <DirectoryPicker
          initialPath={
            (picker === "scan" ? directory : destination) ||
            currentProject?.replace(/[/\\][^/\\]+$/, "")
          }
          t={t}
          onError={onError}
          onCancel={() => setPicker(null)}
          onSelect={(value) => {
            picker === "scan" ? setDirectory(value) : setDestination(value);
            setPicker(null);
          }}
        />
      )}
      <label className="package-option">
        <input
          type="checkbox"
          checked={includeOriginal}
          onChange={(e) => setIncludeOriginal(e.target.checked)}
          disabled={running}
        />
        {t("包含关联的原始 LAS / LAZ（如有）")}
      </label>
      <label>
        {t("同名工程")}
        <select
          aria-label={t("同名工程")}
          value={collision}
          onChange={(e) => setCollision(e.target.value)}
          disabled={running}
        >
          <option value="rename">{t("自动重命名")}</option>
          <option value="skip">{t("跳过")}</option>
        </select>
      </label>
      {job && (
        <section aria-label={t("打包进度")} className="package-progress">
          <strong>{t(labels[job.status] || job.status)}</strong>
          <progress max="100" value={percent} />
          <span>
            {(job.completedBytes / 1024 / 1024).toFixed(1)} /{" "}
            {(job.totalBytes / 1024 / 1024).toFixed(1)} MB
          </span>
          {job.error && <p role="alert">{t(job.error)}</p>}
          <ul>
            {job.items.map((item) => (
              <li key={item.projectPath}>
                <b>{t(labels[item.status] || item.status)}</b>
                <span title={item.projectPath}>
                  {item.output || item.projectPath}
                </span>
                {item.error && <small>{t(item.error)}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="modal-actions">
        {running ? (
          <button
            disabled={job.status === "cancelling"}
            onClick={() =>
              api("/packages/" + job.id + "/cancel", {})
                .then(setJob)
                .catch(onError)
            }
          >
            {t("取消打包")}
          </button>
        ) : (
          <button
            className="primary"
            disabled={loading || !selected.length || !destination.trim()}
            onClick={start}
          >
            {t(loading ? "准备中" : "开始打包")}
          </button>
        )}
      </div>
    </div>
  );
}
