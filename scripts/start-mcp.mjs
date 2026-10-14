import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'mcp', 'generated', 'server.mjs');
const widget = join(root, 'mcp', 'generated', 'zhongxing-canvas-widget.html');
if (!existsSync(bundle) || !existsSync(widget)) {
  throw new Error('众行画布发布包不完整：缺少 MCP Server 或 Widget 构建产物。');
}
await import(pathToFileURL(bundle).href);
