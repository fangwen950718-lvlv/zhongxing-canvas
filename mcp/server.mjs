import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import packageInfo from '../package.json' with { type: 'json' };
import { readWidgetAsset } from './runtime/widget-assets.mjs';
import { downloadOriginalImage } from './runtime/download-image.mjs';
import {startUpscaleTile,completeUpscaleTile,finishUpscaleTiles,cancelImageJob} from './runtime/job-store.mjs';
import { loadProject, saveProject,exportSavedProject } from './runtime/projects.mjs';
import { completeBriefJob, completeImageJob, createBriefJob, createImageEditJob, createImageJob, createImageActionJob, retryImageJob, publicImageJob, readBriefJob, runtime, setBriefJobState, setImageJobState } from './runtime/job-store.mjs';
import { setBriefReferences, resetBriefReferences } from './runtime/job-store.mjs';
import { checkUpdate, installUpdate } from './runtime/updates.mjs';

const VERSION = packageInfo.version;
const WIDGET_URI = `ui://zhongxing-canvas/${VERSION}/index.html`;
const WIDGET_HTML = join(dirname(fileURLToPath(import.meta.url)), 'zhongxing-canvas-widget.html');
const ratioSchema = z.enum(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']);
const referenceImagesSchema = z.array(z.object({ name: z.string().trim().min(1).max(160), dataURL: z.string().max(12_000_000) })).optional();
const creativeOptionSchema = z.object({ title: z.string().trim().min(1).max(120), proposal: z.string().trim().min(1).max(30000), sections: z.array(z.object({ label: z.string().trim().min(1).max(40), content: z.string().trim().min(1).max(5000) })).min(4).max(8).optional(), imagePrompt: z.string().trim().min(1).max(30000) });
const httpsUrl = z.string().max(2048).refine(value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }, '仅支持 HTTPS 来源链接');
const foundReferenceSchema = z.object({ title: z.string().trim().min(1).max(160), source: z.string().trim().min(1).max(160), pageUrl: httpsUrl, imageUrl: httpsUrl.optional(), description: z.string().trim().max(500).optional(), previewFile: z.string().max(4096).optional() });
async function prepareReference(reference) {
  const { previewFile, ...result } = reference;
  if (!previewFile) return result;
  const info = await stat(previewFile);
  if (!info.isFile() || info.size > 88000 || info.size < 12) throw new Error('参考图预览文件需小于 88KB');
  const bytes = await readFile(previewFile);
  const type = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpeg' : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' ? 'webp' : '';
  if (!type) throw new Error('参考预览必须为 PNG、JPEG 或 WebP');
  return { ...result, preview: `data:image/${type};base64,${bytes.toString('base64')}` };
}
const server = new McpServer({ name: 'zhongxing_canvas', version: VERSION }, { instructions: '当用户要求打开众行无限画布时，调用 open_zhongxing_independent_canvas。画布是插件内置 MCP App，不需要本机网页服务或开发工程。画布内任务会通过当前 Codex 对话调用本插件工具并回填。' });

registerAppTool(server,'check_zhongxing_update',{title:'检查画布更新',description:'仅检查众行画布正式版本，不发送画布内容。',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true},_meta:{ui:{visibility:['app']},'openai/widgetAccessible':true}},async()=>({content:[],structuredContent:await checkUpdate(VERSION)}));
registerAppTool(server,'install_zhongxing_update',{title:'更新画布插件',description:'经用户点击后刷新正式插件市场并安装，不删除画布数据。',inputSchema:{},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true},_meta:{ui:{visibility:['app']},'openai/widgetAccessible':true}},async()=>({content:[],structuredContent:await installUpdate(VERSION)}));

registerAppTool(server, 'download_zhongxing_original_image', {
  title: '下载原图', description: '将图片原始字节保存到本机下载文件夹，不覆盖已有同名文件。',
  inputSchema: { dataURL:z.string().max(36_000_000), filename:z.string().min(1).max(200) },
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false},
  _meta:{ui:{visibility:['app']},'openai/widgetAccessible':true},
}, async ({dataURL,filename})=>({content:[],structuredContent:await downloadOriginalImage(dataURL,filename)}));

registerAppTool(server, 'create_zhongxing_image_action_job', {
  title: '创建图片操作任务', description: '延展、去背或三稿约束智能高清，保存原图与目标尺寸，新增结果且不覆盖原图。',
  inputSchema: { kind: z.enum(['relayout', 'remove-background','upscale']), upscaleMode:z.enum(['tiled','whole-resample','texture-preserve']).optional(), sourceImageId: z.string().min(1).max(200), sourceWidth: z.number().int().positive().max(8192), sourceHeight: z.number().int().positive().max(8192), width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192), prompt: z.string().trim().min(1).max(12000), originalDataURL: z.string().max(36_000_000) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  _meta: { ui: { visibility: ['app'] }, 'openai/widgetAccessible': true },
}, async input => ({ content: [], structuredContent: { job: await createImageActionJob(input) } }));
registerAppTool(server, 'retry_zhongxing_image_job', {
  title: '重试失败的图片任务', description: '保留原始输入，重置失败任务等待重发。', inputSchema: { id: z.string().uuid() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  _meta: { ui: { visibility: ['app'] }, 'openai/widgetAccessible': true },
}, async ({ id }) => ({ content: [], structuredContent: { job: await retryImageJob(id) } }));

registerAppTool(server, 'read_zhongxing_widget_asset', {
  title: '读取画布内置资源', description: '仅供画布启动与字体加载使用，按固定大小分块读取插件内置资源。',
  inputSchema: { id: z.string().min(1).max(240), offset: z.number().int().min(0).default(0) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { ui: { visibility: ['app'] }, 'openai/widgetAccessible': true },
}, async ({ id, offset }) => ({ content: [], structuredContent: await readWidgetAsset(dirname(WIDGET_HTML), id, offset) }));

registerAppResource(server, 'zhongxing-canvas-widget', WIDGET_URI, {}, async () => ({ contents: [{ uri: WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text: await readFile(WIDGET_HTML, 'utf8'), _meta: { ui: { prefersBorder: false, csp: { resourceDomains: ['data:', 'blob:'] } }, 'openai/widgetDescription': '众行无限画布：内置 Excalidraw、视觉方案、参考图、生图与标注修改。', 'openai/widgetPrefersBorder': false, 'openai/widgetCSP': { connect_domains: [], resource_domains: ['data:', 'blob:'] } } }] }));

registerAppTool(server, 'open_zhongxing_independent_canvas', {
  title: '打开众行无限画布', description: '打开插件内置的众行无限画布。直接打开内置 MCP App。', inputSchema: { title: z.string().trim().max(120).optional() },
  outputSchema: { version: z.literal(VERSION), widget: z.literal('zhongxing-canvas'), title: z.string(), rendering: z.literal('mcp-app'), dataDirectory: z.string() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { ui: { resourceUri: WIDGET_URI, visibility: ['model', 'app'] }, 'openai/ui': {entrypoints:[{type:'global'},{type:'thread'}]}, 'ui/resourceUri': WIDGET_URI, 'openai/outputTemplate': WIDGET_URI, 'openai/widgetAccessible': true, 'openai/toolInvocation/invoking': '正在打开众行画布…', 'openai/toolInvocation/invoked': '众行画布已打开' },
}, async ({ title } = {}) => ({ content: [{ type: 'text', text: '已打开众行无限画布。' }], structuredContent: { version: VERSION, widget: 'zhongxing-canvas', title: title || '众行无限画布', rendering: 'mcp-app', dataDirectory: runtime }, _meta: { ui: { resourceUri: WIDGET_URI }, 'ui/resourceUri': WIDGET_URI, 'openai/outputTemplate': WIDGET_URI } }));

registerAppTool(server, 'create_zhongxing_image_job', { title: '创建众行画布生图任务', description: '由众行画布创建本机生图任务。', inputSchema: { prompt: z.string().trim().min(1).max(12000), ratio: ratioSchema, referenceImages: referenceImagesSchema, presetId:z.enum(['','real','meme','three-d','product','title']).optional(), ruleText:z.string().max(120000).optional(), ruleLabel:z.string().max(200).optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ['app'] }, 'openai/widgetAccessible': true } }, async (input) => ({ content: [], structuredContent: { job: await createImageJob(input) } }));
registerAppTool(server, 'create_zhongxing_image_edit_job', { title: '创建众行画布图片修改任务', description: '保存原图、箭头注释截图、参考图与修改意见。', inputSchema: { prompt: z.string().trim().min(1).max(12000), ratio: z.string().trim().min(3).max(40), width: z.number().positive().max(20000), height: z.number().positive().max(20000), originalDataURL: z.string().max(36_000_000), annotatedDataURL: z.string().max(36_000_000), referenceImages: referenceImagesSchema }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ['app'] }, 'openai/widgetAccessible': true } }, async (input) => ({ content: [], structuredContent: { job: await createImageEditJob(input) } }));
registerAppTool(server, 'get_zhongxing_image_job', { title: '读取众行画布生图任务', description: '读取任务、原图、标注图、参考图和结果。', inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ['model', 'app'] }, 'openai/widgetAccessible': true } }, async ({ id }) => ({ content: [], structuredContent: { job: await publicImageJob(id) } }));
registerAppTool(server, 'start_zhongxing_image_job', { title: '开始众行画布生图任务', description: '把生图任务标记为处理中。', inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ['model'] } } }, async ({ id }) => ({ content: [], structuredContent: { job: await setImageJobState(id, 'running', 'Codex 正在生成图片') } }));
registerAppTool(server, 'complete_zhongxing_image_job', { title: '完成众行画布生图任务', description: '使用真实 PNG、JPEG 或 WebP 文件完成任务并回填画布。', inputSchema: { id: z.string().uuid(), file: z.string().trim().min(1).max(4096) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ['model'] } } }, async ({ id, file }) => ({ content: [{ type: 'text', text: '图片已回填众行画布。' }], structuredContent: { job: await completeImageJob(id, file) } }));
registerAppTool(server, 'fail_zhongxing_image_job', { title: '标记众行画布生图失败', description: '写回简短失败原因。', inputSchema: { id: z.string().uuid(), message: z.string().trim().min(1).max(500) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ['model'] } } }, async ({ id, message }) => ({ content: [], structuredContent: { job: await setImageJobState(id, 'failed', message) } }));

registerAppTool(server, 'create_zhongxing_brief_job', { title: '创建众行视觉方案任务', description: '保存 brief 与当前审美规则。', inputSchema: { brief: z.string().trim().min(1).max(30000), rulePreset: z.string().trim().max(100).optional(), ruleLabel: z.string().trim().max(200).optional(), ruleText: z.string().max(120000).optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, _meta: { ui: { visibility: ['app'] }, 'openai/widgetAccessible': true } }, async (input) => ({ content: [], structuredContent: { job: await createBriefJob(input) } }));
registerAppTool(server, 'get_zhongxing_brief_job', { title: '读取众行视觉方案任务', description: '读取 brief、规则与方案结果。', inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ['model', 'app'] }, 'openai/widgetAccessible': true } }, async ({ id }) => ({ content: [], structuredContent: { job: await readBriefJob(id) } }));
registerAppTool(server, 'save_zhongxing_op_references', { title: '回填方案参考图', description: '为已完成的一个创意方向保存真实来源和小尺寸预览；搜索失败可写入原因。', inputSchema: { id: z.string().uuid(), index: z.number().int().min(0).max(2), references: z.array(foundReferenceSchema).max(4), message: z.string().max(500).optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ['model'] } } }, async ({ id, index, references, message }) => ({ content: [{ type: 'text', text: '该方向的参考结果已保存。' }], structuredContent: { job: await setBriefReferences(id, index, await Promise.all(references.map(prepareReference)), message) } }));
registerAppTool(server, 'reset_zhongxing_op_references', { title: '重新搜索方案参考图', description: '准备一次新的参考图搜索，不更改方案或画布。', inputSchema: { id: z.string().uuid() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ['app'] }, 'openai/widgetAccessible': true } }, async ({ id }) => ({ content: [], structuredContent: { job: await resetBriefReferences(id) } }));
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

const tileAnnotations={readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false};
registerAppTool(server,'export_zhongxing_project',{title:'导出已保存众行项目',description:'在画布确认保存完成后，直接复制完整项目到下载文件夹；不通过浏览器下载，不覆盖同名项目。',inputSchema:{name:z.string().min(1).max(200)},annotations:tileAnnotations,_meta:{ui:{visibility:['app']},'openai/widgetAccessible':true}},async({name})=>({content:[],structuredContent:await exportSavedProject(name)}));
registerAppTool(server,'start_zhongxing_upscale_tile',{title:'开始高清分块',description:'取得一个未完成区域的裁切、三稿参考和生图要求；每块最多两次，全任务额外重试最多两次。',inputSchema:{id:z.string().uuid(),index:z.number().int().min(0).max(15)},annotations:tileAnnotations,_meta:{ui:{visibility:['model']}}},async({id,index})=>({content:[],structuredContent:{tile:await startUpscaleTile(id,index)}}));
registerAppTool(server,'complete_zhongxing_upscale_tile',{title:'回填高清分块',description:'校验真实生成的局部 PNG，保留已完成区域。不是最终整图回填。',inputSchema:{id:z.string().uuid(),index:z.number().int().min(0).max(15),token:z.string().uuid(),file:z.string().min(1).max(4096)},annotations:tileAnnotations,_meta:{ui:{visibility:['model']}}},async({id,index,token,file})=>({content:[],structuredContent:{job:await completeUpscaleTile(id,index,token,file)}}));
registerAppTool(server,'finish_zhongxing_upscale_tiles',{title:'拼接高清分块',description:'仅在所有分块完成后重叠混合并回填目标像素整图，不补画或插值未完成区域。',inputSchema:{id:z.string().uuid()},annotations:tileAnnotations,_meta:{ui:{visibility:['model']}}},async({id})=>({content:[],structuredContent:{job:await finishUpscaleTiles(id)}}));
registerAppTool(server,'cancel_zhongxing_image_job',{title:'中止分块高清',description:'停止后续分块与回填，保留原图及已完成分块；正在运行的模型调用可能仍会消耗额度。',inputSchema:{id:z.string().uuid()},annotations:tileAnnotations,_meta:{ui:{visibility:['app','model']},'openai/widgetAccessible':true}},async({id})=>({content:[],structuredContent:{job:await cancelImageJob(id)}}));
await server.connect(new StdioServerTransport());

