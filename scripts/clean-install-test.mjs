import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { access, cp, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginLaunchConfig } from './plugin-launch-config.mjs';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/clean-install-test.mjs RELEASE_PLUGIN_ROOT');
const sandbox = await mkdtemp(join(tmpdir(), 'zhongxing-clean-install-'));
const installA = join(sandbox, 'install-a'), installB = join(sandbox, 'install-b'), dataDir = join(sandbox, 'user-data');
await cp(source, installA, { recursive: true });
if ((await readdir(installA)).includes('node_modules')) throw new Error('Release contains node_modules');
for (const required of ['plugin.json','mcp.json','scripts/start-mcp.mjs','mcp/generated/server.mjs','mcp/generated/zhongxing-canvas-widget.html']) await access(join(installA, required));

async function connect(root) {
  const transport = new StdioClientTransport({ ...await pluginLaunchConfig(root), env: { ...process.env, ZHONGXING_CANVAS_DATA_DIR: dataDir, ZHONGXING_CANVAS_ROOT: '' } });
  const client = new Client({ name: 'clean-install-test', version: '2.0.0' });
  await client.connect(transport); return client;
}
const clientA = await connect(installA);
let briefId, imageId;
const project = { format: 'zhongxing-canvas', version: 1, name: '隔离升级保留项目', brief: {}, scene: { elements: [], files: {}, appState: {} } };
try {
  const opened = await clientA.callTool({ name: 'open_zhongxing_independent_canvas', arguments: {} });
  if (opened.structuredContent?.rendering !== 'mcp-app' || opened.structuredContent?.browserUrl) throw new Error('Release is not a direct MCP App');
  const brief = await clientA.callTool({ name: 'create_zhongxing_brief_job', arguments: { brief: '升级保留测试', ruleLabel: '社媒海报', ruleText: '一个主要视觉钩子' } });
  const image = await clientA.callTool({ name: 'create_zhongxing_image_job', arguments: { prompt: '升级保留测试图片', ratio: '1:1' } });
  briefId = brief.structuredContent.job.id; imageId = image.structuredContent.job.id;
  const saved = await clientA.callTool({ name: 'save_zhongxing_project', arguments: { projectJSON: JSON.stringify(project) } });
  if (!saved.structuredContent?.saved) throw new Error('Project save failed');
} finally { await clientA.close(); }

await cp(source, installB, { recursive: true });
const clientB = await connect(installB);
try {
  const brief = await clientB.callTool({ name: 'get_zhongxing_brief_job', arguments: { id: briefId } });
  const image = await clientB.callTool({ name: 'get_zhongxing_image_job', arguments: { id: imageId } });
  if (brief.structuredContent?.job?.brief !== '升级保留测试' || image.structuredContent?.job?.prompt !== '升级保留测试图片') throw new Error('User data did not survive simulated upgrade');
  const restored = await clientB.callTool({ name: 'load_zhongxing_project', arguments: {} });
  if (JSON.parse(restored.structuredContent.projectJSON).name !== project.name) throw new Error('Project did not survive upgrade');
  const corrupt = await clientB.callTool({ name: 'save_zhongxing_project', arguments: { projectJSON: '{broken' } });
  if (!corrupt.isError) throw new Error('Corrupt project accepted');
  const unchanged = await clientB.callTool({ name: 'load_zhongxing_project', arguments: {} });
  if (unchanged.structuredContent.projectJSON !== restored.structuredContent.projectJSON) throw new Error('Corrupt input overwrote project');
  const opened = await clientB.callTool({ name: 'open_zhongxing_independent_canvas', arguments: {} });
  const widget = await clientB.readResource({ uri: opened._meta['ui/resourceUri'] });
  const text = widget.contents?.[0]?.text || '';
  if (text.length < 1000 || Buffer.byteLength(text) > 250_000) throw new Error('Widget entry violates size budget');
  const asset = await clientB.callTool({ name: 'read_zhongxing_widget_asset', arguments: { id: 'application.js.gz', offset: 0 } });
  if (asset.isError || !asset.structuredContent?.base64) throw new Error('Bundled assets missing');
} finally { await clientB.close(); }

const report = { ok: true, sandbox, dataDir, briefId, imageId, releaseHasNodeModules: false, usedLocalhost4318: false, dataSurvivedUpgrade: true };
await writeFile(join(sandbox, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
