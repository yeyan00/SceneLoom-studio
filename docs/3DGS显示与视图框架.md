# 3DGS 编辑与视图框架

## 集成方式

点云继续使用 Three.js/Potree 八叉树；3DGS 在独立 Tab 中直接挂载 SuperSplat 3.7.0 的 PlayCanvas 编辑器。没有 iframe，也不依赖上一级目录部署。原生源码快照位于 `vendor/supersplat`，上游版本和改动说明见该目录 README。

`src/views/GaussianView.jsx` 提供宿主工具条；`gaussian-runtime.js` 管理原生编辑器的创建、加载、显示统计、激活和销毁。原生工具栏、场景树、变换、颜色、显示和数据面板保留。编辑器使用 Shadow DOM 隔离样式和元素 ID，键盘事件限定在当前编辑器，未注册上游 iframe 通信、云发布和 WebMCP。图标字体单独注册到页面字体表。

点云与 GS 的图形上下文、选区和撤销历史独立。Tab 隐藏后暂停绘制并退出活动工具；关闭时等待队列完成，释放监听器、场景及图形设备。未保存编辑关闭前显示确认对话框。后续 DOM、3D Tiles 可以按同一视图宿主模式扩展，目前没有混合画布或相机联动。

GS 默认收起外层工程浏览器、属性侧栏及原生场景面板，让画布占满工作区。外层侧栏可通过右上角布局按钮展开，原生场景面板通过 GS 工具条展开。GS 与点云分别保留侧栏开关状态，切换回来不改变点云布局。

## 当前功能

- 打开普通 Gaussian PLY、压缩 Gaussian PLY 和原生 `.ssproj` 工程。
- 原生矩形、画刷、多边形等选择工具，删除、隐藏、变换、Undo/Redo。
- 高斯、点中心、椭球轮廓显示，原生显示参数和颜色面板。
- 宿主提供适应视图、保存 GS 工程、打开 GS 工程、导出入口；导出保留上游参数对话框，包括压缩 PLY 设置。入口提供 PLY、SPLAT、SOG、SPZ。
- 保留原生场景树的多图层导入入口。这里只保证已验证的格式与流程，未对所有上游功能逐项做兼容承诺。

当前编辑器要求 WebGPU，建议新版 Chrome/Edge。WebGPU 不可用时显示明确错误，不影响点云功能。Gaussian 数据整体加载，不具备点云的八叉树按需加载能力；大型 GS 数据的内存和排序性能仍须单独验证。

## 保存与数据安全

源 PLY/SSProj 通过服务只读访问。GS 工程保存使用 SuperSplat 原生 `.ssproj`，打包场景与数据；导出生成应用修改后的数据，不改写导入的源文件。浏览器支持目录选择 API 时由原生保存对话框选择目录，否则使用下载。原生 SSProj 保存场景快照，不跨重开保留 Undo/Redo 栈。

GS 清单、相机与背景自动保存到 `${SCENELOOM_HOME}/splat-views.json`。启动恢复清单，点击 Tab 后再加载。源文件大小或修改时间变化时拒绝复用旧登记，缺失源记入日志。

GS 的 `.ssproj` 与点云 `project.sceneloom.json` + `project.db` 分开。GS 尚未纳入点云工程打包和统一多资源工程。界面“保存 GS 工程”保存 GS，“保存工程/打包工程”仍针对点云。

后端对 PLY 验证完整 Gaussian 属性、二进制小端、LF 头部及数据长度，普通点云 PLY 不会误送 GS 编辑器；SSProj 后端先验证 ZIP 签名，场景结构由原生加载器进一步验证。

## 验证

```powershell
npm.cmd run build
npm.cmd run test:gaussian
npm.cmd run test:gaussian:public
npm.cmd run test:release
```

`tests/e2e/gaussian-check.mjs` 通过 playwright-cli 操作真实界面，覆盖原生矩形/画刷、删除、Undo/Redo、轮廓切换、PLY 导出、SSProj 保存重开、隐藏暂停、未保存关闭保护与销毁；检查原文件字节不变及导出删除生效。离线小样例还验证 SPLAT、SOG、SPZ 实际下载；覆盖英文切换及关闭侧栏后的 540 px 窄屏。后端集成测试覆盖识别、范围读取、视图持久化、源变化和普通 PLY 拒绝。

公开样例取自 PlayCanvas engine：`examples/assets/splats/guitar.compressed.ply`，固定提交 `7b4f9c0c08a3a22e9c9197a300ab75ca613ed24f`，90,854 个高斯，1,479,876 字节。SHA-256：`04f61b72166394fdfb393dd589b0cb5a8b1b018820c73722278ddcdc2ffedc0f`。运行 `npm.cmd run sample:gaussian` 下载并校验到 `test-results/samples`，模型不加入源码。

2026-10-29：Headless Chrome 155，RTX 5060，WebGPU，DPR 1，渲染区 1075×710。多次公开样例加载约 0.55–0.64 s，57 个运动帧间隔 P95 为 8–8.4 ms，最大约 75–79 ms，存在偶发长帧。加载从运行时创建计时，不含首次引擎脚本下载和解析；帧间隔包含浏览器调度，不等于纯 GPU 耗时，也不能推导为所有操作均小于 50 ms。样例删除 7,878 个高斯后，PLY 导出和 SSProj 重开均为 82,976 个；源文件字节不变。测试报告和截图保存在各次 `test-results` 目录。

完整回归覆盖 32 个单元、13 个集成，以及点云浏览、布局、停靠区、四视图、打包、分类画刷、林业、CHM、标签集、GS 和转换器。最终验证以本次运行报告为准。
