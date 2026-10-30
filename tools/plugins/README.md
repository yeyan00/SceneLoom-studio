# 本地工具扩展

把受信任工具的 `.json` 描述文件放在本目录，重启后台后加载；也可用 `SCENELOOM_TOOLS` 指定其他目录。`*.json.example` 仅为文档示例，不会执行或加载。

```json
{
  "id": "local.clean-cloud",
  "title": "点云自动清理",
  "description": "调用本地清理工具",
  "category": ["自动处理", "点云处理"],
  "executable": "D:/MyTools/clean-cloud.exe",
  "args": ["--input", "{input}", "--output", "{output}"],
  "parameters": [
    { "id": "input", "label": "输入文件", "type": "file", "required": true },
    { "id": "output", "label": "输出文件", "type": "file", "required": true }
  ]
}
```

`category` 支持一或两段：顶层抽屉 → 可选子组 → 工具，合计最多三级。同类工具自动归组。参数支持 `text`、`number`、`file`、`directory`，当前文件参数以路径输入；可用 `default` 设置默认值。`args` 中的 `{参数ID}` 必须已声明，作为独立 argv 替换，不经过 shell。相对 executable 路径相对于本目录解析；也支持绝对路径。工具执行目录为 exe 所在目录。

这些本地工具以当前用户权限运行。宿主只执行已注册的工具 ID，接口不接受临时指定可执行文件。工具的删除源数据等行为由工具自身决定；建议使用独立输出文件。当前不是代码沙箱，也不支持自动安装任意下载插件。

后台记录启动、退出状态、取消和分批输出，右侧展示最近任务；取消使用 Windows 进程树终止。当前只支持单任务表单和输出日志，不自动将通用 EXE 的输出解释为工程分类增量或发布资产，后续通过结果 manifest 扩展。内置 Potree 转换走已有的校验和资产发布流程。
