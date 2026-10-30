import React from "react";
import {
  ChevronRight,
  Cloud,
  Layers3,
  Plus,
  Save,
  Sparkles,
} from "lucide-react";
import { dataTypes } from "../../shared/data-types.mjs";

const icons = { pointcloud: Cloud, gaussian: Sparkles, tiles: Layers3 };

export function ProjectDataTree({
  points,
  sources,
  dataset,
  activeView,
  busy,
  onPoint,
  onSource,
  onAdd,
  onSave,
  t,
  format,
}) {
  const count = points.length + sources.length;
  return (
    <div className="project-data-tree" data-testid="project-data-tree">
      <div className="section-caption project-data-heading">
        <strong>{t("项目数据")}</strong>
        <span>{count}</span>
        <button
          disabled={!count || busy}
          title={t("保存多数据项目")}
          aria-label={t("保存多数据项目")}
          onClick={onSave}
        >
          <Save size={14} />
        </button>
        <button
          disabled={busy}
          title={t("添加数据")}
          aria-label={t("添加数据")}
          onClick={() => onAdd("auto")}
        >
          <Plus size={15} />
        </button>
      </div>
      {dataTypes
        .filter((type) => type.id !== "project")
        .map((type) => {
          const Icon = icons[type.id];
          const entries =
            type.id === "pointcloud"
              ? points
              : sources.filter((source) => source.type === type.id);
          return (
            <details className="data-type-group" key={type.id} open>
              <summary>
                <ChevronRight size={13} className="data-group-chevron" />
                <Icon size={15} />
                <strong>{t(type.label)}</strong>
                <span>{entries.length}</span>
              </summary>
              <button
                className="add-type-data"
                disabled={busy}
                title={t("添加{0}", { 0: t(type.label) })}
                aria-label={t("添加{0}", { 0: t(type.label) })}
                onClick={() => onAdd(type.id)}
              >
                <Plus size={14} />
              </button>
              {entries.map((entry) => {
                const point = type.id === "pointcloud";
                const active = point
                  ? activeView === "pointcloud" && dataset?.id === entry.id
                  : activeView === entry.id;
                const name = point ? entry.metadata.name : entry.name;
                return (
                  <button
                    key={entry.id}
                    disabled={busy}
                    className={`asset ${active ? "active" : ""}`}
                    aria-current={active ? "true" : undefined}
                    title={point ? entry.projectPath : entry.path}
                    onClick={() => (point ? onPoint(entry) : onSource(entry))}
                  >
                    <Icon size={17} />
                    <div>
                      <strong>{name}</strong>
                      <small>
                        {entry.unavailable
                          ? t("源数据不可用，点击重试")
                          : point
                            ? `Potree 2.0 · ${t("{0} 点", { 0: format(entry.metadata.points) })}`
                            : entry.encoding || t(type.label)}
                      </small>
                    </div>
                    {active && <i />}
                  </button>
                );
              })}
              {!entries.length && (
                <div className="empty-data-type">{t("尚未添加数据")}</div>
              )}
            </details>
          );
        })}
    </div>
  );
}
