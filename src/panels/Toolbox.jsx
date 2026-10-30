import React, { useState } from "react";
import { Search, Wrench, ChevronRight, Play } from "lucide-react";
export function Toolbox({ tools, t, onRun }) {
  const [search, setSearch] = useState("");
  const roots = [
    ...new Set([
      "格式转换",
      "自动处理",
      "诊断工具",
      ...tools.map((tool) => tool.category[0]),
    ]),
  ];
  const filtered = tools.filter((tool) =>
    `${t(tool.title)} ${tool.category.map((part) => t(part)).join(" ")} ${t(tool.description || "")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  function leaf(tool) {
    return (
      <button
        key={tool.id}
        role="treeitem"
        aria-level={tool.category.length + 1}
        className="tool-leaf"
        title={t(tool.description || tool.title)}
        onClick={() => onRun(tool)}
      >
        <Play size={13} />
        <span>
          {t(tool.title)}
          <small>{t(tool.description || "")}</small>
        </span>
        <b>
          {tool.kind === "executable"
            ? "EXE"
            : tool.id === "builtin.potree"
              ? "C++"
              : ""}
        </b>
      </button>
    );
  }
  return (
    <section className="toolbox-content" aria-label={t("工具箱")}>
      <div className="tool-search">
        <Search size={14} />
        <input
          aria-label={t("搜索工具…")}
          placeholder={t("搜索工具…")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="tool-drawers">
        {roots
          .filter(
            (root) =>
              !search || filtered.some((tool) => tool.category[0] === root),
          )
          .map((root) => {
            const children = filtered.filter(
                (tool) => tool.category[0] === root,
              ),
              groups = [
                ...new Set(
                  children.map((tool) => tool.category[1]).filter(Boolean),
                ),
              ];
            return (
              <details
                className="tool-drawer"
                key={root + !!search}
                open={search ? true : undefined}
              >
                <summary>
                  <ChevronRight size={14} />
                  <Wrench size={14} />
                  <span>{t(root)}</span>
                  <small>{children.length}</small>
                </summary>
                <div role="tree" aria-label={t(root)}>
                  {children
                    .filter((tool) => tool.category.length === 1)
                    .map(leaf)}
                  {groups.map((group) => (
                    <details className="tool-branch" key={group} open>
                      <summary role="treeitem" aria-level="2">
                        <ChevronRight size={12} />
                        {t(group)}
                      </summary>
                      <div role="group">
                        {children
                          .filter((tool) => tool.category[1] === group)
                          .map(leaf)}
                      </div>
                    </details>
                  ))}
                  {children.length === 0 && (
                    <p className="drawer-empty">
                      {t("此分类暂无工具，可通过插件扩展")}
                    </p>
                  )}
                </div>
              </details>
            );
          })}
      </div>
      {filtered.length === 0 && search && (
        <p className="drawer-empty">{t("未找到匹配工具")}</p>
      )}
      <p className="toolbox-hint">
        {t("工具按分类组织，最多三级；任务在独立进程执行。")}
      </p>
    </section>
  );
}
