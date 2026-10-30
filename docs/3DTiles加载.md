# 3D Tiles 加载显示

## 实现与使用

使用 Three.js 与固定版本 `3d-tiles-renderer` 0.5.3；不引入 Cesium。通过“打开数据”输入本地 `tileset.json`、其他名称的 tileset JSON，或包含 `tileset.json` 的目录。程序在独立 3D Tiles Tab 中显示，首次默认收起外层侧栏，工具条提供适应视图、线框和 LOD 屏幕误差调节（2–32 px，越小越精细，默认 8 px）。鼠标左键旋转、右键平移、滚轮缩放。

瓦片按视锥及屏幕误差调度，支持外部嵌套 tileset。常见的 B3DM 与 GLB 网格，以及 3D Tiles 1.1 隐式层级通过库插件加载。已配置 Draco、KTX2/Basis 和 Meshopt 解码；解码资源随应用部署，不依赖在线 CDN。当前回归样例未逐项覆盖所有压缩扩展及元数据扩展。

当前是加载显示功能，不提供网格编辑、构件属性面板、OSGB 转换、地球底图或与点云同画布叠加。入口暂限本地文件路径，未提供远程 URL/授权服务的打开界面。

## 模块与生命周期

- `server/tiles.mjs`：识别根 JSON、登记资源、持久化视图、按需提供 JSON/模型/纹理及 Range/HEAD 读取。
- `src/views/TilesView.jsx`：宿主工具条、加载/失败提示、激活状态。
- `src/views/tiles-runtime.js`：Three.js 场景、OrbitControls、瓦片调度、解码插件、局部原点、统计与释放。
- `src/views/ViewTabs.jsx` 和主界面：统一非点云视图分派，GS 与 Tiles 按资源类型使用各自运行时。

点云与 GS 不加载瓦片运行时；Tiles 模块按 Tab 延迟加载。隐藏时停止绘制与调度，已有请求可能继续完成。关闭时释放瓦片缓存、控制器、监听器、解码器和 WebGL 上下文。

根包围体确定局部原点，渲染组减去原点，保留原始数据坐标不改写。对接近地球半径的中心坐标，使用径向作为相机上方向；这只是局部浏览定向，不是完整 CRS 识别或投影转换。地方坐标默认 Z 向上，坐标和点云联合配准留待后续。

## 存储边界

源数据原地读取，不复制模型，也不创建点云工程。资源清单及相机位置存入 `${SCENELOOM_HOME}/tiles-views.json`；启动恢复 Tab 清单，点击时加载。清单最多保留 12 个 Tiles 视图。根 JSON 大小或修改时间变化后需重新打开。

本地文件服务只允许访问根 tileset 所在目录及其子目录，并对真实路径做检查。跨父目录引用需要整理到共同数据目录；不能通过 `../` 或符号链接读取根目录外文件。保留完整目录和相对引用，单独复制 JSON 通常不足以打开模型。瓦片清单/相机尚未纳入点云工程打包。

根 JSON 打开时只读取并检查头部结构，不预扫描全部瓦片，所以子瓦片或纹理缺失会在实际加载时提示。子文件未进行完整内容哈希校验；打开期间应避免外部修改数据集。

## 验证

```powershell
npm.cmd run test:tiles
npm.cmd run test:tiles:public
npm.cmd run test:release
```

离线用例生成带 ECEF 大坐标的 B3DM、GLB、嵌套 JSON 和基础隐式 subtree，真实浏览器检查模型像素、旋转、线框、Tab 暂停/关闭、恢复清单、中英文及窄屏布局。后端测试验证路径约束、Range/HEAD、相机持久化与非法输入。

公开样例：CesiumGS/3d-tiles-samples 的 `1.0/TilesetWithDiscreteLOD`（Stanford Dragon），固定提交 `a30bfdf2d6cc55f4c3078e8aea3a793af6ebfd56`。上游样例 README 标注 CC0。`npm.cmd run sample:tiles` 下载到 `test-results/samples/tiles-dragon`，同时记录来源、大小和 SHA-256；模型不进入源码仓库。

公开样例已验证显示、缩放触发更高 LOD：缓存 2 个模型、显示 1 个模型，细化后 14,782 个三角形；截图位于对应 `test-results` 目录。该样例仅几 MB，不能据此推断城市级倾斜数据的性能和内存上限。
