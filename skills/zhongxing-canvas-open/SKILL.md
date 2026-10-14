---
name: zhongxing-canvas-open
description: 当用户要求打开、重新打开或刷新众行无限画布时，直接加载插件内置 MCP App；除非用户明确指定，否则不要使用 Cowart。
---

# 打开众行无限画布

1. 调用 `open_zhongxing_independent_canvas`。
2. 画布应直接显示为插件内置 MCP App，并主动请求大画布显示模式；不打开 localhost，不启动 Vite，不查找开发工程。
3. 对“打开众行无限画布”这一无修饰请求，始终使用本技能和本插件工具；不要调用 Cowart 或旧版 `zhongxing-infinite-canvas`。

