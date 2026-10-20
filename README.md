# 众行无限画布

## 2.1.0 更新

此版本基于已验收的本机测试版发布。升级保留已有画布、图片、规则和任务数据。

- 审美规则统一选择，通过“编辑”管理名称、全文、删除和上传；取消不生效，保存后随项目保留。原有规则没有只读限制，删除不会在重启后重新出现。
- “编辑”中的“通用底层规则”可完整修改工作顺序、层级与画面规则，应用于所有分类；清空后不再补回默认文本。预览和方案任务使用同一份完整规则快照，历史项目沿用原始默认规则，项目导入导出包含修改。
- 插件头像使用项目负责人提供的产品图标，画布顶部品牌 Logo 保持不变。
- 已声明全局与对话侧栏入口；是否显示、可固定由宿主客户端决定，当前未完成原生侧栏固定验收。兼容客户端仍可通过“打开众行无限画布”进入。

- 选中单张图片，可修改标注、下载原图、延展尺寸或 AI 去除干净背景。
- 下载原图使用图片文件原始字节，不包含画布、缩放或批注；正式插件直接保存到本机“下载”文件夹，同名文件自动编号、不覆盖。网页模式提供预览和保存链接。
- 延展支持比例预设和自定义像素宽高，按新画幅重新布局，结果放在原图旁。AI 可能改动细节，请核对文案与元素。仅对正确比例的结果做等比重采样，不强行拉伸或裁切。
- AI 去背接受主体裁切后的不同尺寸、比例，保留结果原始字节，仅检查有效主体和透明 PNG，不因尺寸不同重生。复杂背景和精细发丝暂不保证效果。
- 图片操作条位于图片上方；批注箭头、文字与原图自动成组，随图移动。已有批注在载入时补充成组，不改变元素位置。
- 工具栏不再显示抓手和橡皮擦，仍可用空格拖动画布；延展弹窗的“取消”和“确认延展”按钮尺寸一致。
- 图片操作由当前 Codex 对话处理，失败后可重试。原图、批注及历史项目保留。
- 界面采用中性灰，品牌 Logo 和画布图片保留原色。

众行无限画布是一款自包含的 Codex 插件：在 MCP App 中直接运行 Excalidraw 画布，并把视觉方案、生图与箭头标注改图任务交给当前 Codex 对话。正式安装版不需要复制开发工程、执行 `npm install`、启动 Vite、配置 API Key 或访问 localhost。

v2.0.3 的画布入口约 109 KB。编辑器、样式及原始字体随插件安装，通过仅供界面调用的 MCP 工具以每块不超过 96 KB 读取，并校验 SHA-256；不会把约 26 MB 的页面一次性交给宿主。启动时有加载进度与可重试错误提示，不依赖 CDN 或额外的本地网页服务。

## 功能

- 无限画布：平移、缩放、文字、箭头、常用图形、图片导入、吸附、网格对齐、撤销重做。
- 本机项目：IndexedDB 自动保存，`.zhongxing.json` 完整导入导出，PNG/SVG 导出。
- 方案助手：一个 brief 输入框，选择审美规则库，并列生成 3 个创意 OP 与 demo 级生图提示词。
- 审美规则：内置 5 份公开基础规则，也可导入自己的 Markdown/TXT/JSON 知识库。
- AI 图片：文字生图、多张参考图、箭头批注改图；结果自动回填，原图与标注不被覆盖。

## 系统要求

- macOS、Windows 或 Linux 上的 Codex 桌面版。
- Node.js 22 或更高版本（仅用于启动插件内已经打包好的 MCP Server；无需安装 npm 依赖）。
- 当前 Codex 账号可使用内置生图工具，才能完成真实生图与改图。
- 从 GitHub 安装及更新需要可用的 Git。全新 Mac 调用系统 Git 时可能提示安装 Apple Command Line Tools；这是获取 Git 的常见方式，不要求安装完整 Xcode，也不需要编译本插件。运行正式插件不需要编译器。

## 从 GitHub 安装

```bash
codex plugin marketplace add fangwen950718-lvlv/zhongxing-canvas --ref main
codex plugin add zhongxing-canvas@zhongxing-canvas-github
```

安装后完全退出并重新打开 Codex，新建对话发送：

```text
打开众行无限画布
```

画布应直接显示为 Codex 内置 MCP App。正式插件不依赖本机网页服务。

## 更新与卸载

```bash
codex plugin marketplace upgrade zhongxing-canvas-github
codex plugin remove zhongxing-canvas@zhongxing-canvas-github
codex plugin add zhongxing-canvas@zhongxing-canvas-github
```

卸载插件不会主动删除下述用户数据目录。升级前仍建议导出 `.zhongxing.json`。

## 数据、备份与迁移

插件画布通过 MCP 把内容、图片和 brief 原子保存到用户数据目录的 `projects/current.zhongxing.json`，并保留上一份 `.bak`。Vite 开发网页继续使用 IndexedDB。可携带的正式备份是画布顶部导出的 `.zhongxing.json`；它包含项目图片。导入前会校验文件，损坏文件不会覆盖当前项目。

方案和图片任务保存在稳定的用户数据目录，而不是插件缓存目录：

- macOS：`~/Library/Application Support/zhongxing-canvas/`
- Windows：`%APPDATA%\zhongxing-canvas\`
- Linux：`${XDG_DATA_HOME:-~/.local/share}/zhongxing-canvas/`

目录中的 `jobs/`、`brief-jobs/`、`job-inputs/` 和 `images/` 可整体备份。插件更新不会删除这些文件。需要迁移时，先导出项目，再在 Codex 完全退出后复制该目录。

## 常见故障

- **显示“此应用过大，无法显示”**：请升级到 v2.0.3 或更新版本；v2.0.2 及之前返回了过大的单文件页面。更新 Marketplace 后重新安装插件，再完全退出 Codex 并在新对话打开。无需重装 Node 或删除项目。首次打开时资源从本机插件分块加载，保持窗口可用，按页面进度等待。
- **GitHub 更新超时 / fatal: early EOF**：这表示下载未完成，不代表本机画布数据损坏。更新成功前不要先卸载当前插件。可向维护者获取对应 Release ZIP，解压后将其作为本地 Marketplace 安装，不需要重新构建源码。

- **提示打开工具未加载，日志出现 unknown field title**：v2.0.2 已移除 MCP 服务条目中的展示元数据，修复严格加载器拒绝配置的问题，并显式使用插件根目录启动路径。请更新 Marketplace 并重新安装最新版插件，完全退出 Codex 后新建对话；无需重装 Node 或删除项目数据。

- **只看到空白或加载失败**：完全退出 Codex 后重开；再运行 `codex plugin marketplace upgrade zhongxing-canvas-github` 并重新安装插件。
- **方案或生图没有开始**：确认画布是从当前 Codex 对话打开；画布会向当前对话发送任务，可在对话中看到进度。
- **不能选择文件或下载**：使用画布提供的 JSON 文本备份和图像预览链接；不同 Codex 宿主版本对原生文件对话框的支持可能不同。
- **图片任务失败**：任务和输入仍保存在用户数据目录；查看画布状态提示，不要用占位图覆盖原任务。
- **旧项目**：项目格式继续使用 `format: "zhongxing-canvas", version: 1`，V1.x 导出的项目可以导入。

## 隐私与安全

- 项目、参考图、标注图和任务默认只写入本机。
- 插件不接入远程统计或第三方 API Key。
- 生图与方案请求会发送给当前 Codex 会话处理，受用户所在组织的 Codex 数据政策约束。
- GitHub 发布包不包含客户资料、测试图片、运行任务、开发者个人路径或原始内部审美文档。
- 自定义知识库只随当前项目保存在本机；公开分享项目文件前请自行检查其内容与授权。

## 开发与构建

终端用户不需要本节。开发者从源码构建时：

```bash
npm ci
npm test
npm run build
npm run build:plugin
npm run probe:plugin
npm run verify:release
npm run pack:release
npm run test:clean-install
# 已安装 Codex CLI 的开发环境还必须执行实际加载器回归测试
npm run test:codex-loader
```

- `npm run dev`：Vite 开发模式，默认 `127.0.0.1:4317`。
- `npm run build:plugin`：生成 `mcp/generated/server.mjs`、小型 Widget 入口、离线压缩资源、资源校验清单和版本清单。
- `npm run probe:plugin`：通过 stdio 实际启动发布 MCP，读取 Widget 并创建隔离任务。
- `npm run verify:release`：检查版本、清单、必需文件、个人路径和遗留本机服务依赖。

正式插件入口是仓库根目录的 `plugin.json` 和 `mcp.json`；`.codex-plugin/plugin.json` 与 `.mcp.json` 仅作兼容。版本以根 `package.json` 为单一来源，构建会同步并验证发布清单。

界面验收可运行 `node scripts/widget-host-test.mjs release/zhongxing-canvas`，在浏览器打开输出的测试地址。测试宿主通过真实发布 MCP 读取小入口及资源，并在禁止外部网络的 iframe CSP 下渲染。其方案与图片回填使用明确标记的固定测试数据，不代表真实模型质量测试；正式 Codex 的 UI 展开方式和生图权限仍取决于宿主版本和账号策略。

## 许可证

项目原创代码使用 MIT License。Excalidraw、React、字体和其他依赖保留各自许可证；详情见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [licenses/](licenses/)。

