# 众行无限画布 V2 稳定基线

正式源码与插件发布根目录：本仓库根目录。V2 的发布版是自包含 MCP App，不依赖 Vite、localhost、开发工程、个人 Skill 符号链接或插件目录外文件。

## 已验证能力

- Excalidraw 编辑、图片导入、吸附、网格对齐、文字、箭头、图形、拖动缩放、撤销重做。
- IndexedDB 自动保存；`.zhongxing.json` 项目导入导出；PNG/SVG 导出。
- 选择完整审美规则库，生成 3 个创意 OP、分段说明与独立 demo 提示词。
- 5 个公开基础规则库；用户可导入自定义规则库。
- 文字生图、多张参考图、图片多箭头标注改图；结果回填且不覆盖原图和标注。
- MCP Server、Widget 与任务存储逻辑均包含在发布包中；运行数据保存在操作系统用户数据目录。

## 不可破坏的回归约束

1. `npm test`、`npm run build`、`npm run build:plugin`、`npm run probe:plugin`、`npm run verify:release` 全部通过。
2. 发布包不包含 `127.0.0.1:4318`、`ZHONGXING_CANVAS_ROOT`、个人绝对路径或插件外部源码引用。
3. 项目格式继续兼容 `{format:"zhongxing-canvas", version:1}`；新字段必须是可选增量。
4. 不覆盖用户已有画布、原图、标注和任务记录；升级不删除用户数据目录。
5. 图片、知识库与项目导入失败时保留当前内容，并给出可恢复提示。
6. 方案协议兼容旧 `proposal` / `imagePrompt`，新方案保持 3 个 OP。
7. 不引入 Cowart 服务、统计 SDK、外部 API Key 或收费 API 作为基础依赖。
8. 不把客户资料、测试图片、任务记录或未授权内部规则提交到 Git。

## 关键边界

- `src/main.tsx`：画布装配、保存恢复、任务轮询和回填。
- `src/codexBridge.ts`：MCP App 工具与 `ui/message` 兼容层；相对 `/api` 仅供 Vite 开发模式。
- `mcp/server.mjs`：正式 MCP 工具与 UI Resource。
- `mcp/runtime/`：跨平台稳定数据目录和任务存储。
- `skills/`：方案、生图、改图与打开画布流程。
- `scripts/build-plugin.mjs`：生成不依赖 `node_modules` 的 MCP Server、单文件 Widget 和版本清单。

## 发布门禁

v2.0.2 起，MCP stdio 服务条目仅允许 type、command、args、env、cwd；title、description 等展示元数据不得放入服务条目。args 与 cwd 使用 ${PLUGIN_ROOT}，不得依赖启动时的工作目录。探针与隔离测试必须读取发布清单，而不是硬编码启动命令。发布机器还须执行 npm run test:codex-loader，使用隔离 CODEX_HOME 下的真实 Codex App Server 复现旧配置错误，并确认新配置返回打开画布工具。

构建后必须在隔离临时目录中只复制发布文件，清空 `ZHONGXING_CANVAS_ROOT`，不运行 4317/4318，不提供 `node_modules`，实际启动 MCP、读取 Widget、创建任务，并验证升级后测试数据仍存在。随后才能打标签和发布 Release。

