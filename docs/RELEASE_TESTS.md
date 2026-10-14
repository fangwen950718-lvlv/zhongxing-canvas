# V2.0.0 发布验收

2026-10-14，macOS arm64、Node 24、Codex 桌面自带 CLI。

- 21 项源码测试通过，覆盖旧项目格式、IndexedDB、规则库选择、任务状态、参考图、重复回填保护。
- Vite 正式构建、MCP 打包、Widget 构建、发布文件扫描通过。
- Codex 本地 Marketplace 实际安装了 2.0.0，缓存内没有 node_modules。
- 从只含发布文件的隔离目录启动 MCP，读取完整 UI Resource，创建方案与图片任务。
- 模拟更换插件安装目录后，任务和项目仍可读取；损坏 JSON 未覆盖项目。
- 标准 MCP Apps SDK 测试宿主实际打开完整 iframe 画布，磁盘保存显示正确；ui/message 自动提交方案，三 OP 回填成功；图片与标注修改通过 tools/call 回填，新图与原图及箭头文字同时保留。
- 测试宿主的方案和第一轮回填使用明确标记的确定性夹具，不代表真实模型方案质量。
- 另用 Codex 内置 imagegen 实际生成橙色陶瓷立方体照片、编辑为蓝色，并通过发布 MCP 验证真实文件回填、参考图存储、原图哈希不变与重复完成拒绝。测试图片不纳入 Git。
- 字体动态 URL 已转为内嵌 data URL，不需字体 CDN；正式 MCP 不监听 HTTP 端口。

新安装后仍需在新 Codex 对话中验收宿主的全屏支持和 ui/message 权限；标准协议宿主测试不能代替每个 Codex 版本的实际 UI 行为。旧会话不会自动热加载新插件定义。

用户旧版网页 IndexedDB 数据需要导出 `.zhongxing.json` 后在新版导入；插件不能跨网页 origin 静默读取数据库。

