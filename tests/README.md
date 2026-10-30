# 测试与回归约定

不要求每个功能改动都执行全量回归。先检查影响范围，再运行相关测试；发布前执行完整检查。

Windows 转换器中文路径专项诊断：`node tests/desktop/converter-utf8-check.mjs`；加 `--real` 可同时验证 `data/linye` 两份原始 LAS。该脚本只修改测试 EXE 的 manifest，不替换正式工具。报告中的 `baseline-chinese-input` 失败是用于复现旧版问题的对照；patched 六项及真实数据应成功。测试结果保存在独立的 `test-results/*-converter-utf8` 目录。

| 场景                                           | 建议检查                         |
| ---------------------------------------------- | -------------------------------- |
| 文档说明                                       | 核对内容、链接，无需运行产品测试 |
| 独立逻辑修改                                   | 对应单元测试及直接调用方         |
| 翻译、布局修改                                 | 国际化单元测试、界面与停靠区检查 |
| 点云解码、选区、编辑规则                       | 单元、接口、编辑交互、渲染检查   |
| 日志、工具注册                                 | 单元、接口、工具箱与日志交互     |
| 保存格式、公共服务、依赖、构建配置、大范围重构 | 全量回归                         |
| 发布版本                                       | 全量回归，加实际大数据验收       |

```powershell
npm.cmd test                     # 快速检查：单元 + 服务接口，不依赖构建或浏览器
npm.cmd run test:unit
npm.cmd run test:integration
npm.cmd run test:related -- --files src/locales/en.mjs --plan
npm.cmd run test:related -- --files shared/edits.mjs
npm.cmd run test:related -- --changed --plan
npm.cmd run test:related -- --base main
npm.cmd run test:e2e              # 自动构建 + 编辑、UI、停靠区浏览器检查
npm.cmd run test:workspace        # 局部四视图、集合选区、连续编辑、保存并发
npm.cmd run test:package          # 批量打包、目录浏览、未保存状态、断开源后重开
npm.cmd run test:brush            # 穿透分类画刷、快捷键、锁定相机、整笔历史及反馈延迟
npm.cmd run test:forestry         # 插件 Ribbon、人工单木、自动编号、共享画刷与保存重开
npm.cmd run test:chm              # CHM 参数、预览、原子应用、撤销重做和保存重开
npm.cmd run test:labels           # 标签集、别名/语义、JSON 交换、工程副本和窄屏
npm.cmd run test:chm-performance  # 环境变量指定数据/范围，测后台计算与接口响应
npm.cmd run test:performance      # 20 万已加载点与长历史的独立 Worker/SQLite 基准
npm.cmd run test:converter        # 真实 PotreeConverter 转换与缓存复用
npm.cmd run test:release          # 构建、快速检查、浏览器、转换器全部执行
npm.cmd run test:gaussian         # 原生 GS 编辑/导出/工程重开/Tab 清理，无网络依赖
npm.cmd run test:tiles            # B3DM/GLB/隐式层级、相机、Tab 暂停/关闭
npm.cmd run test:tiles:public     # 额外下载 Cesium Dragon，验证实际模型和 LOD
npm.cmd run test:gaussian:public  # 额外下载并验证公开压缩 PLY，记录运动帧间隔
npm.cmd run sample:gaussian       # 下载固定版本公开样例，校验 SHA-256
```

`--plan` 只输出选择结果与文件对应关系，不执行测试。未指定文件时读取 Git 已暂存、未暂存及未跟踪文件；当前仓库尚未形成提交基线时，建议用 `--files` 明确本次范围。目录路径请展开为文件路径。未知代码、依赖与公共测试设施变动会保守选择全量，映射集中在 `runner/selection.mjs`；新增模块时同步维护映射。选择结果是辅助判断，不能代替对跨模块影响的审查。

## 目录职责

- `unit/`：解码、编辑规则、国际化、日志、工具清单及回归选择策略。
- `integration/`：HTTP Range、保存重开、源数据变更检测、Origin 校验、工具进程、转换器。
- `e2e/`：playwright-cli 编辑流程、10 种语言/窗口组合、3 种着色与 EDL 像素检查、停靠区和日志。
- `helpers/`：隔离服务、动态端口、浏览器会话、产物目录。
- `fixtures/`：运行时生成确定性的 Potree 八叉树和 LAS，小样本不入库。
- `runner/`：执行入口和影响范围映射。
- `performance/`：编辑和 CHM 计算的可复现性能基准；输出测量条件和结果，不把基准当作跨设备性能承诺。

服务使用系统临时目录存放测试状态、生成数据及转换输出，完成后清理；不会编辑用户工程侧车。各浏览器测试创建独立会话，截图保留在忽略提交的 `test-results/`，可用 `SCENELOOM_TEST_ARTIFACTS` 指定目录。测试不依赖用户私有磁盘路径，也不要求事先打开开发服务。

浏览器检查需要已安装的 playwright-cli 及其浏览器；可用 `PLAYWRIGHT_CLI_JS` 指定 CLI 脚本。转换检查需要项目 `tools` 下的 PotreeConverter，或设置 `POTREE_CONVERTER`。缺少依赖或执行失败会返回非零状态，不会记为通过。默认快速检查不要求这两项。

生成样本用于功能回归，不能证明亿级点云的性能。发布前还需用真实大数据验证首屏时间、视角切换、连续编辑延迟、内存、长历史保存和转换吞吐，并记录硬件与点数。当前框架尚未设定这些性能指标的自动门槛。

可设置 `SCENELOOM_PERF_POTREE` 为实际 Potree 目录后运行 `test:workspace`，使用真实源数据但仍将工程状态隔离在临时目录；原始点云不改写。报告位于该次 `test-results/` 的 `workspace-report.txt`，含首个可见点、初始预算加载、历史交互及帧间隔数据。自动化端到端耗时含 Playwright 与状态采样开销，内部呈现耗时从命令状态变更到下一次有效绘制提交，不等于 GPU 实际显示延迟；首次读取也可能命中系统缓存。

新增回归用例应验证用户行为或稳定边界，修复缺陷时优先补复现用例；简单样式和文案修改不必添加镜像实现的测试。一次相关检查通过后，不因未修改代码反复全量重跑。

画刷测试同样支持 `SCENELOOM_PERF_POTREE` 指定真实数据。输出 `brush-report.txt` 和桌面/手机截图，报告包含 50 ms 基准、P50/P95/最大反馈延迟、达标比例、加载点数及松手提交时间。反馈延迟记录输入处理到覆盖该批轨迹的全部加载节点提交绘制；合并批次从其中最早的待处理输入计时，不只计算最后一帧。它不包含操作系统输入派发之前的时间，也不代表 GPU 完成或屏幕呈现。功能通过和性能是否达到基准分开报告，避免把偶发尖峰隐藏在通过标记中。
# Windows 桌面绿色版验证

先执行 `npm run build:portable`，再执行 `npm run test:desktop`。测试解压 ZIP 到中文及空格路径，在真实 Tauri/WebView2 中验证三种数据视图、自带 LAS 转换器、数据关联与后台退出。报告及截图位于 `test-results/desktop-*/`。修改桌面外壳、原生对话框、后台启动或分发脚本时运行；发布绿色版前必须运行。开发构建环境参见 [desktop-build.md](../docs/desktop-build.md)。

# 本地 3D Tiles 兼容验证

构建前端后执行 `node tests/e2e/tiles-local-check.mjs data/tile3`，检查真实数据的瓦片、CRN 纹理和控制台错误，截图写入 `test-results/tiles-local/`。该目录的用户数据不作为仓库测试资源分发。绿色版测试还可设置 `SCENELOOM_TEST_TILES` 为实际数据目录，在原生 WebView2 中复核。常规 `test:tiles` 增加了超过旧缓存上限的 340 分支生成数据。
