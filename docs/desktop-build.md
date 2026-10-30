# Windows 绿色版

Windows 构建会通过 `scripts/prepare-converter.mjs` 为旧版 PotreeConverter 嵌入进程级 UTF-8 清单，保留原来的普通用户权限声明。只调整工具本身的路径编码，不改变系统区域设置。首次准备未修补的 EXE 需要 Windows SDK 的 `mt.exe`；绿色包运行不需要 SDK。此机制需要 Windows 10 1903 或更新系统。中文目录、中文 LAS 文件名及含空格路径的转换和复用已纳入回归。

当前采用 Tauri 2 + 系统 WebView2，携带 Node.js 后台与 PotreeConverter。暂不生成安装包。用户解压整个目录后运行 `SceneLoom.exe`，无需自行安装 Node.js、Python 或 Rust。

## 构建和验证

开发机需要 Node.js 24、Rust MSVC 工具链和 Visual Studio C++ 编译工具。项目 `build/toolchains/cargo`、`build/toolchains/rustup` 下的本地工具链存在时，构建脚本优先使用它们。

```powershell
npm ci
npm run build:portable
npm run test:desktop
```

产物位于 `release/SceneLoom-Studio-<版本>-win-x64/` 及同名 ZIP。程序与后台文件必须整体分发。运行时生成的 `data/` 包含设置、日志和 WebView2 缓存，构建压缩包始终排除该目录。

桌面测试将 ZIP 解压到中文及空格路径，以只有系统目录的 PATH 启动真实 WebView2，通过 Playwright CDP 验证本地数据、三类渲染视图、转换器与关闭后台。报告和截图保存在 `test-results/desktop-*/`。`--test-cdp-port` 仅用于显式开启测试调试端口，正常启动不开放该端口。

## 本地运行

原始数据可以位于任意可访问的数据目录，不需要复制到程序目录。桌面打开对话框提供系统文件/目录选择；转换结果和工程关联沿用现有项目规则。后台绑定随机回环端口，通过每次启动生成的会话令牌隔离请求，原生窗口只允许导航到该后台。关闭程序时先请求正常退出，Windows Job Object 负责清理后台及其子进程。

当前绿色版需要系统已安装 WebView2 Evergreen Runtime，未包含离线运行时。程序目录需可写，用于 `data/`。这是未签名的首版 Windows x64 产物，暂未制作安装、自动更新和跨平台分发。

Tauri 复用系统 WebView2，Electron 携带 Chromium。当前产品仍携带 Node.js，因此不能用裸 Tauri 示例体积估算本项目大小；实际体积以绿色包为准。
