import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = process.argv[2] ? path.resolve(process.argv[2]) : root;
const testRuntime = await mkdtemp(path.join(tmpdir(), 'zhongxing-plugin-probe-'));
const transport = new StdioClientTransport({ command: 'node', args: ['./scripts/start-mcp.mjs'], cwd: pluginRoot, env: { ...process.env, ZHONGXING_TEST_RUNTIME: testRuntime } });
const client = new Client({ name: 'zhongxing-canvas-probe', version: '2.0.0' });

await client.connect(transport);
try {
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  for (const name of ['open_zhongxing_independent_canvas','create_zhongxing_image_job','create_zhongxing_image_edit_job','get_zhongxing_image_job','start_zhongxing_image_job','complete_zhongxing_image_job','fail_zhongxing_image_job','create_zhongxing_brief_job','get_zhongxing_brief_job','complete_zhongxing_brief_job','fail_zhongxing_brief_job']) {
    if (!names.includes(name)) throw new Error(`Missing tool: ${name}`);
  }
  const opened = await client.callTool({ name: 'open_zhongxing_independent_canvas', arguments: { title: 'Probe' } });
  if (opened.structuredContent?.rendering !== 'mcp-app') throw new Error('Canvas is not a direct MCP App');
  if ('browserUrl' in (opened.structuredContent || {})) throw new Error('Release still exposes a localhost browser URL');
  const resource = await client.readResource({ uri: opened._meta['ui/resourceUri'] });
  const html = resource.contents?.[0]?.text || '';
  for (const marker of ['生图 brief','修改标注','create_zhongxing_image_job','indexedDB','ZONE']) if (!html.includes(marker)) throw new Error(`Widget missing ${marker}`);
  if (/127\.0\.0\.1:4318|ZHONGXING_CANVAS_ROOT|api\/handoffs/.test(html)) throw new Error('Widget contains legacy local-service dependency');

  const brief = await client.callTool({ name: 'create_zhongxing_brief_job', arguments: { brief: '隔离测试', rulePreset: 'social-poster', ruleLabel: '社媒海报', ruleText: '单一视觉钩子' } });
  if (brief.structuredContent?.job?.status !== 'queued') throw new Error('Brief job creation failed');
  const image = await client.callTool({ name: 'create_zhongxing_image_job', arguments: { prompt: '隔离测试图', ratio: '1:1' } });
  if (image.structuredContent?.job?.status !== 'queued') throw new Error('Image job creation failed');
  console.log(JSON.stringify({ ok: true, tools: names.length, widgetBytes: Buffer.byteLength(html), runtime: testRuntime }, null, 2));
} finally {
  await client.close();
}

