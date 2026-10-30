import React, { useEffect, useState } from "react";
import { Check, FileText, Loader2, X } from "lucide-react";
import { taskRunning } from "./useTasks.js";

const labels = {
  queued: "等待中",
  running: "进行中",
  cancelling: "取消中",
  cancelled: "已取消",
  succeeded: "已完成",
  failed: "失败",
};
function TaskCard({ task, t, onCancel, onDismiss, history = false }) {
  const running = taskRunning(task);
  return (
    <article
      className="task-card"
      data-task-id={task.id}
      data-status={task.status}
    >
      <div>
        {running ? (
          <Loader2 size={14} className="spin" />
        ) : task.status === "succeeded" ? (
          <Check size={14} />
        ) : (
          <FileText size={14} />
        )}
        <strong>{t(task.title || "任务")}</strong>
        <small>{t(labels[task.status])}</small>
      </div>
      {task.source && (
        <p className="task-source" title={task.source}>
          {task.source}
        </p>
      )}
      {task.error && <p className="task-error">{t(task.error)}</p>}
      {history ? (
        <details>
          <summary>{t("查看详情")}</summary>
          <pre>{task.log || task.error || t(labels[task.status])}</pre>
        </details>
      ) : (
        <pre>{task.log || task.error || t("正在启动任务…")}</pre>
      )}
      {task.status === "running" && (
        <button onClick={() => onCancel(task.id)}>{t("取消任务")}</button>
      )}
      {!running && !history && (
        <button onClick={() => onDismiss(task.id)}>
          <X size={12} />
          {t("收起任务")}
        </button>
      )}
    </article>
  );
}

export function TaskPanel({ tasks, onCancel, onRefresh, t }) {
  const [dismissed, setDismissed] = useState(new Set());
  const [now, setNow] = useState(Date.now());
  const dismiss = (id) =>
    setDismissed((previous) => new Set([...previous, id]));
  useEffect(() => {
    const remaining = tasks
      .filter(
        (task) =>
          ["succeeded", "cancelled"].includes(task.status) && task.finishedAt,
      )
      .map((task) => task.finishedAt + 4000 - Date.now())
      .filter((value) => value > 0);
    if (!remaining.length) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(...remaining) + 20,
    );
    return () => clearTimeout(timer);
  }, [tasks, now]);
  const current = tasks.filter(
    (task) =>
      taskRunning(task) ||
      (!dismissed.has(task.id) &&
        (task.status === "failed" ||
          (task.finishedAt &&
            task.finishedAt + 4000 > Math.max(now, Date.now())))),
  );
  const currentIds = new Set(current.map((task) => task.id));
  const history = tasks.filter(
    (task) => !taskRunning(task) && !currentIds.has(task.id),
  );
  return (
    <section className="tasks-content" aria-label={t("任务面板")}>
      <div className="task-panel-heading">
        <strong>{t("当前任务")}</strong>
        <button onClick={onRefresh}>{t("刷新")}</button>
      </div>
      {!current.length && (
        <p className="drawer-empty">{t("暂无进行中的任务")}</p>
      )}
      {current.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          t={t}
          onCancel={onCancel}
          onDismiss={dismiss}
        />
      ))}
      <details className="task-history">
        <summary>
          {t("任务历史")} <span>{history.length}</span>
        </summary>
        <p className="toolbox-hint">
          {t("保留本次服务运行期间的转换与工具任务。")}
        </p>
        {history.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            t={t}
            onCancel={onCancel}
            history
          />
        ))}
      </details>
    </section>
  );
}
