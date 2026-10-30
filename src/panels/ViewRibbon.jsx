import React from "react";
import { FileText, Layers3 } from "lucide-react";
import { RibbonButton } from "../components/Ribbon.jsx";

export function ViewRibbon({
  panels,
  activePanel,
  leftOpen,
  logOpen,
  onProject,
  onPanel,
  onLogs,
  renderViewActive,
  t,
}) {
  return (
    <>
      <div className="ribbon-group">
        <div className="ribbon-actions">
          <RibbonButton
            large
            icon={Layers3}
            className={leftOpen ? "selected" : ""}
            aria-pressed={leftOpen}
            onClick={onProject}
          >
            {t("项目数据")}
          </RibbonButton>
          {panels.map(({ id, label, icon: Icon, pointOnly }) => (
            <RibbonButton
              key={id}
              icon={Icon}
              disabled={pointOnly && renderViewActive}
              className={activePanel === id ? "selected" : ""}
              aria-pressed={activePanel === id}
              onClick={() => onPanel(id)}
            >
              {t("{0}面板", { 0: t(label) })}
            </RibbonButton>
          ))}
          <RibbonButton
            icon={FileText}
            className={logOpen ? "selected" : ""}
            aria-pressed={logOpen}
            onClick={onLogs}
          >
            {t("日志面板")}
          </RibbonButton>
        </div>
      </div>
    </>
  );
}
