import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import packageInfo from '../package.json' with { type: 'json' };
import { loadProject, saveProject } from './runtime/projects.mjs';
import { completeBriefJob, completeImageJob, createBriefJob, createImageEditJob, createImageJob, publicImageJob, readBriefJob, runtime, setBriefJobState, setImageJobState } from './runtime/job-store.mjs';

const VERSION = packageInfo.version;
const WIDGET_URI = `ui://zhongxing-canvas/${VERSION}/index.html`;
const WIDGET_HTML = join(dirname(fileURLToPath(import.meta.url)), 'zhongxing-canvas-widget.html');
const ratioSchema = z.enum(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']);
const referenceImagesSchema = z.array(z.object({ name: z.string().trim().min(1).max(160), dataURL: z.string().max(12_000_000) })).optional();
const creativeOptionSchema = z.object({ title: z.string().trim().min(1).max(120), proposal: z.string().trim().min(1).max(30000), sections: z.array(z.object({ label: z.string().trim().min(1).max(40), content: z.string().trim().min(1).max(5000) })).min(4).max(8).optional(), imagePrompt: z.string().trim().min(1).max(30000) });
const server = new McpServer({ name: 'zhongxing_canvas', version: VERSION }, { instructions: '当用户要求打开众行无限画布时，调用 open_zhongxing_independent_canvas。画布是插件内置 MCP App，不需要 localhost、Vite 或 Cowart。画布内任务会通过当前 Codex 对话调用本插件工具并回填。' });

registerAppResource(server, 'zhongxing-canvas-widget', WIDGET_URI, {}, async () => ({ contents: [{ uri: WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text: await readFile(WIDGET_HTML, 'utf8'), _meta: { ui: { prefersBorder: false, csp: { resourceDomains: ['data:', 'blob:'] } }, 'openai/widgetDescription': '众行无限画布：内置 Excalidraw、视觉方案、参考图、生图与标注修改。', 'openai/widgetPrefersBorder': false, 'openai/widgetCSP': { connect_domains: [], resource_domains: ['data:', 'blob:'] } } }] }));

registerAppTool(server, 'open_zhongxing_independent_canvas', {
  title: '打开众行无限画布', description: '打开插件内置的众行无限画布。不要调用 Cowart，也不要打开 localhost。', inputSchema: { title: z.string().trim().max(120).optional() },
  outputSchema: { version: z.literal(VERSION), widget: z.literal('zhongxing-canvas'), title: z.string(), rendering: z.literal('mcp-app'), dataDirectory: z.string() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { ui: { resourceUri: WIDGET_URI, visibility: ['model', 'app'] }, 'ui/resourceUri': WIDGET_URI, 'openai/outputTemplate': WIDGET_URI, 'openai/widgetAccessible': true, 'openai/toolInvocation/invoking': '正在打开众行画布…', 'openai/toolInvocation/invoked': '众行画布已打开' },
}, async ({ title } = {}) => ({ content: [{ type: 'text', text: '已打开众行无限画布。' }], structuredContent: { version: VERSION, widget: 'zhongxing-canvas', title: title || '众行无限画布', rendering: 'mcp-app', dataDirectory: runtime }, _meta: { ui: { resourceUri: WIDGET_URI }, 'ui/resourceUri': WIDGET_URI, 'openai/outputTemplate': WIDGET_URI } }));

registerAppTool(server, 'create_zhongxing_image_job', { title: '创建众行画布生图任务', description: '由众行画布创建本机生图任务。', inputSchema: { prompt: z.string().trim().min(1).max(12000), ratio: ratioSchema, referenceImages: referenceImagesSchema }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ['app'] }, 'openai/widgetAccessible': true } }, async (input) => ({ content: [], structuredContent: { job: await createImageJob(input) } }));
registerAppTool(server, 'create_zhongxing_image_edit_job', { title: '创建众行画布图片修改任务', description: '保存原图、箭头注释截图、参考图与修改意见。', inputSchema: { prompt: z.string().trim().min(1).max(12000), ratio: z.string().trim().min(3).max(40), width: z.number().positive().max(20000), height: z.number().positive().max(20000), originalDataURL: z.string().max(36_000_000), annotatedDataURL: z.string().max(36_000_000), referenceImages: referenceImagesSchema }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ['app'] }, 'openai/widgetAccessible': true } }, async (input) => ({ content: [], structuredContent: { job: await createImageEditJob(input) } }));
registerAppTool(server, 'get_zhongxing_image_job', { title: '读取众行画布生图任务', description: '读取任务、原图、标注图、参考图和结果。', inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ['model', 'app'] }, 'openai/widgetAccessible': true } }, async ({ id }) => ({ content: [], structuredContent: { job: await publicImageJob(id) } }));
registerAppTool(server, 'start_zhongxing_image_job', { title: '开始众行画布生图任务', description: '把生图任务标记为处理中。', inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ['model'] } } }, async ({ id }) => ({ content: [], structuredContent: { job: await setImageJobState(id, 'running', 'Codex 正在生成图片') } }));
registerAppTool(server, 'complete_zhongxing_image_job', { title: '完成众行画布生图任务', description: '使用真实 PNG、JPEG 或 WebP 文件完成任务并回填画布。', inputSchema: { id: z.string().uuid(), file: z.string().trim().min(1).max(4096) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ['model'] } } }, async ({ id, file }) => ({ content: [{ type: 'text', text: '图片已回填众行画布。' }], structuredContent: { job: await completeImageJob(id, file) } }));
registerAppTool(server, 'fail_zhongxing_image_job', { title: '标记众行画布生图失败', description: '写回简短失败原因。', inputSchema: { id: z.string().uuid(), message: z.string().trim().min(1).max(500) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ['model'] } } }, async ({ id, message }) => ({ content: [], structuredContent: { job: await setImageJobState(id, 'failed', message) } }));

registerAppTool(server, 'create_zhongxing_brief_job', { title: '创建众行视觉方案任务', description: '保存 brief 与当前审美规则。', inputSchema: { brief: z.string().trim().min(1).max(30000), rulePreset: z.string().trim().max(100).optional(), ruleLabel: z.string().trim().max(200).optional(), ruleText: z.string().max(120000).optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ['app'] }, 'openai/widgetAccessible': true } }, async (input) => ({ content: [], structuredContent: { job: await createBriefJob(input) } }));
registerAppTool(server, 'get_zhongxing_brief_job', { title: '读取众行视觉方案任务', description: '读取 brief、规则与方案结果。', inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ['model', 'app'] }, 'openai/widgetAccessible': true } }, async ({ id }) => ({ content: [], structuredContent: { job: await readBriefJob(id) } }));
registerAppTool(server, 'complete_zhongxing_brief_job', { title: '完成众行视觉方案任务', description: '回填三组视觉方案及提示词。', inputSchema: { id: z.string().uuid(), options: z.array(creativeOptionSchema).length(3).optional(), proposal: z.string().trim().min(1).max(30000).optional(), imagePrompt: z.string().trim().min(1).max(30000).optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ['model'] } } }, async ({ id, options, proposal, imagePrompt }) => ({ content: [{ type: 'text', text: '三组视觉方案已回填众行画布。' }], structuredContent: { job: await completeBriefJob(id, options || proposal, imagePrompt) } }));
registerAppTool(server, 'fail_zhongxing_brief_job', { title: '标记众行视觉方案失败', description: '写回简短失败原因。', inputSchema: { id: z.string().uuid(), message: z.string().trim().min(1).max(500) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ['model'] } } }, async ({ id, message }) => ({ content: [], structuredContent: { job: await setBriefJobState(id, 'failed', message) } }));

registerAppTool(server, 'load_zhongxing_project', {
  title: '恢复众行项目', description: '读取用户数据目录中的当前项目。', inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { ui: { visibility: ['app'] }, 'openai/widgetAccessible': true },
}, async () => ({ content: [], structuredContent: { projectJSON: await loadProject() } }));
registerAppTool(server, 'save_zhongxing_project', {
  title: '保存众行项目', description: '把当前项目原子保存到用户数据目录，保留上一份备份。',
  inputSchema: { projectJSON: z.string().max(100 * 1024 * 1024) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { ui: { visibility: ['app'] }, 'openai/widgetAccessible': true },
}, async ({ projectJSON }) => { await saveProject(projectJSON); return { content: [], structuredContent: { saved: true } }; });

await server.connect(new StdioServerTransport());

