import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { getUserDataRoot } from './data-dir.mjs';
import { validateDimensions, normalizeImageOutput } from './image-output.mjs';
import {makeUpscaleGuides} from './upscale-guides.mjs';
import {planUpscaleTiles} from './tile-plan.mjs';
import {tileReference,tilePrompt,normalizeTile,stitchTiles} from './tiled-upscale.mjs';
import {runTextureUpscale} from './texture-runner.mjs';

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
  if(input.ruleText!==undefined&&(typeof input.ruleText!=='string'||input.ruleText.length>120000))throw new Error('审美规则超出限制');
  if(input.ruleLabel!==undefined&&(typeof input.ruleLabel!=='string'||input.ruleLabel.length>200))throw new Error('规则名称无效');
  if(input.presetId!==undefined&&!['','real','meme','three-d','product','title'].includes(input.presetId))throw new Error('无效质感预设');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 12000 || !Object.hasOwn(ratios, input.ratio)) throw new Error('请输入提示词并选择有效比例。');
  const id = randomUUID();
  const [width, height] = ratios[input.ratio];
  const references = await saveReferenceImages(id, input.referenceImages);
  return persist(imageJobPath(id), { id, kind: 'generate', prompt: input.prompt.trim(), ratio: input.ratio, width, height, ...references, ...(input.ruleText?{ruleText:input.ruleText,ruleLabel:input.ruleLabel||''}:{}),...(input.presetId?{presetId:input.presetId}:{}), status: 'queued', createdAt: new Date().toISOString() });
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
export async function createImageActionJob(input) {
  if (!['relayout', 'remove-background','upscale'].includes(input.kind)) throw new Error('无效图片操作');
  validateDimensions(input.sourceWidth, input.sourceHeight);
  validateDimensions(input.width, input.height);
  if(input.upscaleMode!==undefined&&(!['tiled','whole-resample','texture-preserve'].includes(input.upscaleMode)||input.kind!=='upscale'))throw new Error('无效高清模式');
  const tiles=input.kind==='upscale'&&input.upscaleMode==='tiled'?planUpscaleTiles(input.width,input.height):undefined;
  if (typeof input.sourceImageId !== 'string' || !input.sourceImageId || input.sourceImageId.length > 200) throw new Error('来源图片标识无效');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 12000) throw new Error('图片操作要求无效');
  const original = parseDataURL(input.originalDataURL);
  let guides;
  if(input.kind==='upscale') {
    const factor=input.width/input.sourceWidth;
    if(![2,4].includes(factor)||input.height!==input.sourceHeight*factor)throw new Error('智能高清只支持原图的 ×2 或 ×4');
    if(original.ext!=='png'||original.bytes.readUInt32BE(16)!==input.sourceWidth||original.bytes.readUInt32BE(20)!==input.sourceHeight)throw new Error('智能高清需要尺寸匹配的原图 PNG');
    if(input.upscaleMode!=='texture-preserve')guides=makeUpscaleGuides(original.bytes);
  }
  const id = randomUUID(), dir = join(runtime, 'job-inputs');
  await mkdir(dir, { recursive: true });
  const originalPath = join(dir, `${id}-original.${original.ext}`);
  await writeFile(originalPath, original.bytes, { mode: 0o600 });
  if(input.upscaleMode==='texture-preserve'){
    const result=await runTextureUpscale(original.bytes,input.width,input.height);
    if(result.bytes.length>25*1024*1024)throw new Error('放大结果超过25MB，请降低倍率');
    const imageDir=join(runtime,'images');await mkdir(imageDir,{recursive:true});
    const imageName=`${id}.png`;await writeFile(join(imageDir,imageName),result.bytes,{mode:0o600});
    return persist(imageJobPath(id),{id,kind:'upscale',upscaleMode:'texture-preserve',sourceImageId:input.sourceImageId,sourceWidth:input.sourceWidth,sourceHeight:input.sourceHeight,width:input.width,height:input.height,ratio:`${input.width}:${input.height}`,prompt:input.prompt,originalPath,imageName,mimeType:'image/png',status:'completed',progress:100,quality:result.quality,message:'本地保真放大完成：轻度平涂去噪与双线性插值，无AI重绘；原有强噪纹可能仍保留，不是超分恢复',createdAt:new Date().toISOString()});
  }
  const guidePaths={};
  if(guides)for(const [name,bytes] of Object.entries(guides)){const file=join(dir,`${id}-${name}.png`);await writeFile(file,bytes,{mode:0o600});guidePaths[name]=file;}
  return persist(imageJobPath(id), { id, kind: input.kind, prompt: input.prompt.trim(), sourceImageId: input.sourceImageId, sourceWidth: input.sourceWidth, sourceHeight: input.sourceHeight, width: input.width, height: input.height, ratio: `${input.width}:${input.height}`, originalPath, ...(guides?{guidePaths,scale:input.width/input.sourceWidth,reconstruction:true}:{}),...(input.upscaleMode==='whole-resample'?{upscaleMode:'whole-resample',message:'等待整图 AI 修复，随后统一放大尺寸'}:{}),...(tiles?{upscaleMode:'tiled',tiles,maxTileRetries:2,message:`分块高清已准备：共 ${tiles.length} 块`}:{}), outputFormat: 'png', transparent: input.kind === 'remove-background', status: 'queued', createdAt: new Date().toISOString() });
}
export async function retryImageJob(id) {
  const job = await readImageJob(id);
  if (job.status !== 'failed') throw new Error('只有失败任务可以重试');
  return persist(imageJobPath(id), { ...job, status: 'queued', message: '等待重新发送到 Codex', attempts: (job.attempts || 0) + 1, updatedAt: new Date().toISOString() });
}
export async function setImageJobState(id, status, message) {
  const job = await readImageJob(id);
  if (!['running', 'failed'].includes(status)) throw new Error('无效状态');
  if (job.status === 'completed'||job.status==='cancelled') throw new Error('任务已结束，不可重复执行');
  if(status==='failed'&&job.upscaleMode==='tiled')for(const tile of job.tiles)if(tile.status==='running')tile.status='failed';
  if(status==='running'&&job.upscaleMode==='whole-resample')message='正在整图 AI 修复，完成后本地统一放大尺寸';
  return persist(imageJobPath(id), { ...job, status, message: message?.slice(0, 500), updatedAt: new Date().toISOString() });
}
export async function completeImageJob(id, file, internal={}) {
  const job = await readImageJob(id);
  if (job.status === 'completed') throw new Error('该任务已完成，不覆盖原结果');
  if(job.status==='cancelled')throw new Error('任务已中止，不写入结果');
  if(job.upscaleMode==='tiled'&&!internal.fromTiles)throw new Error('分块任务必须逐块回填，再调用拼接工具完成');
  const source = resolve(file); let bytes = await readFile(source);
  let processing;
  if (bytes.length > 25 * 1024 * 1024) throw new Error('图片超过 25MB');
  if(job.upscaleMode==='whole-resample'){
    if(bytes.equals(await readFile(job.originalPath)))throw new Error('必须先使用 AI 重新生成整图，不能直接放大原文件');
    const nativeWidth=bytes.length>=24?bytes.readUInt32BE(16):0,nativeHeight=bytes.length>=24?bytes.readUInt32BE(20):0;
    processing={method:'ai-whole+lanczos3',nativeWidth,nativeHeight,targetWidth:job.width,targetHeight:job.height,resampled:nativeWidth!==job.width||nativeHeight!==job.height};
  }
  const nativeBytes=bytes;
  if (['relayout', 'remove-background','upscale'].includes(job.kind)) {
    try { bytes = normalizeImageOutput(job, bytes); if (bytes.length > 25 * 1024 * 1024) throw new Error('处理后的图片超过 25MB'); }
    catch (error) { await setImageJobState(id, 'failed', error.message); throw error; }
  }
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('只接受真实 PNG/JPEG/WebP 文件');
  const mimeType = png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp', ext = png ? 'png' : jpeg ? 'jpg' : 'webp';
  const imageDir = join(runtime, 'images'); await mkdir(imageDir, { recursive: true });
  if(processing){processing.nativeImageName=`${id}-native.png`;await writeFile(join(imageDir,processing.nativeImageName),nativeBytes,{mode:0o600});}
  const imageName = `${id}.${ext}`; await writeFile(join(imageDir, imageName), bytes, { mode: 0o600 });
  const dimensions = job.kind === 'remove-background' ? {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),ratio:`${bytes.readUInt32BE(16)}:${bytes.readUInt32BE(20)}`} : {};
  return persist(imageJobPath(id), { ...job, ...dimensions, ...(processing?{processing}:{}),status: 'completed', progress: 100, message: processing?`整图 AI 修复 ${processing.nativeWidth}×${processing.nativeHeight} → 输出 ${job.width}×${job.height}${processing.resampled?'（Lanczos 重采样，非原生目标分辨率）':'（原生尺寸，无需重采样）'}`:'图片生成完成，已返回画布', imageName, mimeType, updatedAt: new Date().toISOString() });
}
export async function publicImageJob(id) {
  const job = await readImageJob(id);
  if (job.status !== 'completed') return job;
  const bytes = await readFile(join(runtime, 'images', job.imageName));
  return { ...job, dataURL: `data:${job.mimeType};base64,${bytes.toString('base64')}` };
}

// Serialize tile writes within this server. An attempt token prevents late results
// from a cancelled/retried generation from replacing a newer tile.
const tileLocks=new Map();
function withTileLock(id,work){const previous=tileLocks.get(id)||Promise.resolve();const next=previous.catch(()=>{}).then(work);tileLocks.set(id,next);return next.finally(()=>{if(tileLocks.get(id)===next)tileLocks.delete(id);});}
function tiledJob(job){if(job.upscaleMode!=='tiled')throw new Error('不是分块高清任务');if(['completed','cancelled'].includes(job.status))throw new Error('任务已结束');}
export function startUpscaleTile(id,index){return withTileLock(id,async()=>{
  const job=await readImageJob(id);tiledJob(job);
  const tile=job.tiles[index];if(!tile)throw new Error('分块编号无效');
  if(tile.status==='completed')throw new Error('此块已完成，请跳过，不重复生图');
  if(tile.status==='running')throw new Error('此块已有生成请求，请先回填或标记失败');
  const retries=job.tiles.reduce((sum,t)=>sum+Math.max(0,t.attempts-1),0);
  if(tile.attempts>=2||(tile.attempts>0&&retries>=job.maxTileRetries))throw new Error('已达到分块重试预算，请保留现有结果并停止');
  const crop=tileReference(await readFile(job.originalPath),job.scale,tile),dir=join(runtime,'job-inputs');
  const cropPath=join(dir,`${id}-tile-${index}.png`);await writeFile(cropPath,crop,{mode:0o600});
  const guides=makeUpscaleGuides(crop),guidePaths={};
  for(const [name,bytes] of Object.entries(guides)){const file=join(dir,`${id}-tile-${index}-${name}.png`);await writeFile(file,bytes,{mode:0o600});guidePaths[name]=file;}
  Object.assign(tile,{status:'running',attempts:tile.attempts+1,token:randomUUID()});
  await persist(imageJobPath(id),{...job,status:'running',message:`分块高清：正在生成第 ${index+1}/${job.tiles.length} 块（已完成 ${job.tiles.filter(t=>t.status==='completed').length} 块）`});
  return {index,token:tile.token,cropPath,guidePaths,originalPath:job.originalPath,prompt:tilePrompt(job,tile)};
});}
export function completeUpscaleTile(id,index,token,file){return withTileLock(id,async()=>{
  const job=await readImageJob(id);tiledJob(job);const tile=job.tiles[index];
  if(!tile||tile.status!=='running'||tile.token!==token)throw new Error('分块未开始、已完成或请求已失效');
  try{
    const raw=await readFile(resolve(file));if(raw.length>25*1024*1024)throw new Error('分块超过 25MB');
    const bytes=normalizeTile(raw),dir=join(runtime,'job-tiles',id);await mkdir(dir,{recursive:true});
    tile.file=join(dir,`${index}.png`);await writeFile(tile.file,bytes,{mode:0o600});tile.status='completed';
  }catch(error){tile.status='failed';await persist(imageJobPath(id),{...job,status:'failed',message:`第 ${index+1} 块失败：${error.message}`});throw error;}
  const done=job.tiles.filter(t=>t.status==='completed').length;
  return persist(imageJobPath(id),{...job,message:`分块高清：已完成 ${done}/${job.tiles.length} 块`,progress:Math.round(done/job.tiles.length*95)});
});}
export function finishUpscaleTiles(id){return withTileLock(id,async()=>{
  const job=await readImageJob(id);tiledJob(job);
  if(job.tiles.some(t=>t.status!=='completed'))throw new Error('还有分块未完成，不能拼接');
  const bytes=stitchTiles(job.width,job.height,job.tiles,await Promise.all(job.tiles.map(t=>readFile(t.file))));
  const file=join(runtime,'job-tiles',id,'stitched.png');await writeFile(file,bytes,{mode:0o600});
  return completeImageJob(id,file,{fromTiles:true});
});}
export function cancelImageJob(id){return withTileLock(id,async()=>{
  const job=await readImageJob(id);tiledJob(job);
  return persist(imageJobPath(id),{...job,status:'cancelled',message:'分块高清已中止，原图与已完成分块均保留。'});
});}

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

