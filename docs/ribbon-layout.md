# Ribbon 布局与扩展

功能区采用 72px 的混合布局，顶部菜单保持单行。主操作采用大图标及下方文字，辅助操作采用小图标及右侧文字，并可按两行纵向排列。窄窗口通过功能区横向滚动访问工具，仍可整体折叠。

公共组件位于 `src/components/Ribbon.jsx`，内置林业插件也可复用：

- `RibbonButton`：`icon` 指定 Lucide 图标，`large` 切换大按钮，其他属性沿用原生按钮。
- `RibbonSplitButton`：主按钮执行当前工具，箭头展开同类选项。`label`、`menuLabel` 由调用方翻译；`options` 使用 `{value, label, icon, disabled}`；`value` 与 `onSelect` 由调用方管理。
- `ribbon-group` 包含工具组及下方说明，`ribbon-actions` 排列按钮，`ribbon-stack` 将辅助操作排成两行。

下拉菜单使用 Portal 脱离功能区滚动容器，避免被裁切。支持方向键、Home/End、Enter、Escape、点击外部关闭，以及关闭后回到箭头按钮。仅把同类工具合并，删除等操作仍保留独立的禁用条件。

`tests/e2e/ribbon-check.mjs` 已纳入 `ui` 回归，验证双语 slogan、大小按钮布局、工具切换、菜单焦点和窄屏位置；绿色版测试同时验证原生 WebView2 下拉交互。
