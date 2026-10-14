import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { getUserDataRoot } from './data-dir.mjs';

export const runtime = getUserDataRoot();
const idPattern = /^[a-f0-9-]{36}$/;
export const ratios = {
  '1:1': [1024, 1024], '4:3': [1365, 1024], '3:4': [1024, 1365],
  '16:9': [1536, 864], '9:16': [864, 1536], '3:2': [1536, 1024], '2:3': [1024, 1536],
};

function checkedId(id) {
  if (!idPattern.test(id)) throw new Error('无效任务编号');
  return id;
}
function imageJobPath(id) { return join(runtime, 'jobs', `${checkedId(id)}.json`); }
function briefJobPath(id) { return join(runtime, 'brief-jobs', `${checkedId(id)}.json`); }
async function persist(file, value) {
  await mkdir(resolve(file, '..'), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
  return value;
}
function parseDataURL(value) {
  const match = typeof value === 'string' && value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/);
  if (!match) throw new Error('只接受 PNG、JPEG 或 WebP 图片数据');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('图片数据为空或超过 25MB');
  return { mimeType: match[1], bytes, ext: match[1] === 'image/png' ? 'png' : match[1] === 'image/jpeg' ? 'jpg' : 'webp' };
}
async function saveReferenceImages(id, images = []) {
  if (!Array.isArray(images)) throw new Error('参考图格式无效');
  if (!images.length) return { referencePaths: [], referenceNames: [] };
  const parsed = images.map((item, index) => {
    if (!item || typeof item.name !== 'string' || item.name.length > 160) throw new Error('参考图名称无效');
    const image = parseDataURL(item.dataURL);
    if (image.bytes.length > 8 * 1024 * 1024) throw new Error('每张参考图需小于 8MB');
    return { ...image, name: item.name || `参考图 ${index + 1}` };
  });
  if (parsed.reduce((sum, item) => sum + item.bytes.length, 0) > 32 * 1024 * 1024) throw new Error('参考图总大小需小于 32MB');
  const inputDir = join(runtime, 'job-inputs');
  await mkdir(inputDir, { recursive: true });
  const referencePaths = [], referenceNames = [];
  for (const [index, item] of parsed.entries()) {
    const file = join(inputDir, `${id}-reference-${index + 1}.${item.ext}`);
    await writeFile(file, item.bytes, { mode: 0o600 });
    referencePaths.push(file); referenceNames.push(item.name);
  }
  return { referencePaths, referenceNames };
}

export async function createImageJob(input) {
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 12000 || !Object.hasOwn(ratios, input.ratio)) throw new Error('请输入提示词并选择有效比例。');
  const id = randomUUID();
  const [width, height] = ratios[input.ratio];
  const references = await saveReferenceImages(id, input.referenceImages);
  return persist(imageJobPath(id), { id, kind: 'generate', prompt: input.prompt.trim(), ratio: input.ratio, width, height, ...references, status: 'queued', createdAt: new Date().toISOString() });
}
export async function createImageEditJob(input) {
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 12000) throw new Error('请填写有效的修改意见');
  if (!Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width <= 0 || input.height <= 0) throw new Error('原图尺寸无效');
  const id = randomUUID();
  const original = parseDataURL(input.originalDataURL), annotated = parseDataURL(input.annotatedDataURL);
  const inputDir = join(runtime, 'job-inputs');
  await mkdir(inputDir, { recursive: true });
  const originalPath = join(inputDir, `${id}-original.${original.ext}`), annotatedPath = join(inputDir, `${id}-annotated.${annotated.ext}`);
  await writeFile(originalPath, original.bytes, { mode: 0o600 });
  await writeFile(annotatedPath, annotated.bytes, { mode: 0o600 });
  const references = await saveReferenceImages(id, input.referenceImages);
  return persist(imageJobPath(id), { id, kind: 'edit', prompt: input.prompt.trim(), ratio: input.ratio, width: Math.round(input.width), height: Math.round(input.height), sourceWidth: Math.round(input.width), sourceHeight: Math.round(input.height), originalPath, annotatedPath, ...references, status: 'queued', createdAt: new Date().toISOString() });
}
export async function readImageJob(id) { return JSON.parse(await readFile(imageJobPath(id), 'utf8')); }
export async function setImageJobState(id, status, message) {
  const job = await readImageJob(id);
  if (!['running', 'failed'].includes(status)) throw new Error('无效状态');
  if (job.status === 'completed') throw new Error('已完成任务不可重复执行');
  return persist(imageJobPath(id), { ...job, status, message: message?.slice(0, 500), updatedAt: new Date().toISOString() });
}
export async function completeImageJob(id, file) {
  const job = await readImageJob(id);
  if (job.status === 'completed') throw new Error('该任务已完成，不覆盖原结果');
  const source = resolve(file), bytes = await readFile(source);
  if (bytes.length > 25 * 1024 * 1024) throw new Error('图片超过 25MB');
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('只接受真实 PNG/JPEG/WebP 文件');
  const mimeType = png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp', ext = png ? 'png' : jpeg ? 'jpg' : 'webp';
  const imageDir = join(runtime, 'images'); await mkdir(imageDir, { recursive: true });
  const imageName = `${id}.${ext}`; await copyFile(source, join(imageDir, imageName));
  return persist(imageJobPath(id), { ...job, status: 'completed', progress: 100, message: '图片生成完成，已返回画布', imageName, mimeType, updatedAt: new Date().toISOString() });
}
export async function publicImageJob(id) {
  const job = await readImageJob(id);
  if (job.status !== 'completed') return job;
  const bytes = await readFile(join(runtime, 'images', job.imageName));
  return { ...job, dataURL: `data:${job.mimeType};base64,${bytes.toString('base64')}` };
}

function validSections(sections) { return sections === undefined || Array.isArray(sections) && sections.length <= 10 && sections.every((section) => section && typeof section.label === 'string' && section.label.trim() && section.label.length <= 40 && typeof section.content === 'string' && section.content.trim() && section.content.length <= 5000); }
function validOptions(options) { return Array.isArray(options) && options.length === 3 && options.every((option) => option && typeof option.title === 'string' && option.title.trim() && option.title.length <= 120 && typeof option.proposal === 'string' && option.proposal.trim() && option.proposal.length <= 30000 && validSections(option.sections) && typeof option.imagePrompt === 'string' && option.imagePrompt.trim() && option.imagePrompt.length <= 30000); }
export async function createBriefJob({ brief, rulePreset = 'social-poster', ruleLabel = '社媒海报', ruleText = '' }) {
  if (typeof brief !== 'string' || !brief.trim() || brief.length > 30000) throw new Error('请输入生图 brief。');
  if (typeof rulePreset !== 'string' || rulePreset.length > 100 || typeof ruleLabel !== 'string' || !ruleLabel.trim() || ruleLabel.length > 200 || typeof ruleText !== 'string' || !ruleText.trim() || ruleText.length > 120000) throw new Error('审美规则库数据无效。');
  const id = randomUUID();
  return persist(briefJobPath(id), { id, brief: brief.trim(), rulePreset, ruleLabel: ruleLabel.trim(), ruleText: ruleText.trim(), status: 'queued', createdAt: new Date().toISOString() });
}
export async function readBriefJob(id) { return JSON.parse(await readFile(briefJobPath(id), 'utf8')); }
export async function setBriefJobState(id, status, message) {
  const job = await readBriefJob(id);
  if (!['running', 'failed'].includes(status)) throw new Error('无效状态');
  if (job.status === 'completed') throw new Error('已完成任务不可重复执行');
  return persist(briefJobPath(id), { ...job, status, message: message?.slice(0, 500), updatedAt: new Date().toISOString() });
}
export async function completeBriefJob(id, optionsOrProposal, imagePrompt) {
  const job = await readBriefJob(id);
  if (job.status === 'completed') throw new Error('该任务已完成，不覆盖原结果');
  const options = Array.isArray(optionsOrProposal) ? optionsOrProposal : [{ title: '方案', proposal: optionsOrProposal, imagePrompt }];
  if (options.length === 1) {
    const option = options[0];
    if (!option || typeof option.proposal !== 'string' || !option.proposal.trim() || typeof option.imagePrompt !== 'string' || !option.imagePrompt.trim()) throw new Error('方案或提示词无效');
    return persist(briefJobPath(id), { ...job, status: 'completed', proposal: option.proposal.trim(), imagePrompt: option.imagePrompt.trim(), options, updatedAt: new Date().toISOString() });
  }
  if (!validOptions(options)) throw new Error('三组方案或提示词无效');
  const normalized = options.map((option) => ({ title: option.title.trim(), proposal: option.proposal.trim(), sections: option.sections?.map((section) => ({ label: section.label.trim(), content: section.content.trim() })), imagePrompt: option.imagePrompt.trim() }));
  return persist(briefJobPath(id), { ...job, status: 'completed', proposal: normalized[0].proposal, imagePrompt: normalized[0].imagePrompt, options: normalized, updatedAt: new Date().toISOString() });
}

