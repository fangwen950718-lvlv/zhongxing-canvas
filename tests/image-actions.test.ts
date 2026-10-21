import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { originalFile, actionPrompt, commandForImageJob, imageActionFrame, nextImagePosition, imageActionsPosition } from '../src/imageActionUtils';
import { validateDimensions, decodePNG } from '../mcp/runtime/image-output.mjs';
import { downloadOriginalImage } from '../mcp/runtime/download-image.mjs';

const dir = await mkdtemp(join(tmpdir(),'zx-image-actions-'));
process.env.ZHONGXING_CANVAS_DATA_DIR = dir;
const store = await import('../mcp/runtime/job-store.mjs');
function picture(width=8,height=8,transparent=false) {
  const png=new PNG({width,height});png.data.fill(255);
  if(transparent)png.data[3]=0;
  return PNG.sync.write(png);
}
const original=picture(), dataURL=`data:image/png;base64,${original.toString('base64')}`;
const input=(kind='relayout',width=16,height=8)=>({kind,sourceImageId:'source-1',sourceWidth:8,sourceHeight:8,width,height,originalDataURL:dataURL,prompt:actionPrompt(kind as 'relayout',width,height)});

test('original download preserves bytes, MIME and native file extension',async()=>{
  const file=originalFile(dataURL,'项目/原图');
  assert.equal(file.name,'项目-原图.png');assert.equal(file.blob.type,'image/png');
  assert.deepEqual(Buffer.from(await file.blob.arrayBuffer()),original);
  const jpeg=originalFile('data:image/jpeg;base64,/9j/','jpeg');assert.equal(jpeg.name,'jpeg.jpg');
  assert.throws(()=>originalFile('https://bad','image'),/无效/);
});
test('action prompts lock content, alpha, target dimensions and near-image frame ratio',()=>{
  assert.match(actionPrompt('relayout',1600,900),/1600×900/);assert.match(actionPrompt('relayout',1600,900),/不新增、删减/);
  assert.match(actionPrompt('remove-background',800,800),/真实 alpha/);
  assert.deepEqual(imageActionFrame({width:1600,height:900},{width:400,height:900}),{width:1600,height:900});
  assert.match(commandForImageJob({id:'test',kind:'relayout'} as any),/zhongxing-canvas-image-action/);
  for(const dims of [[0,1],[-1,4],[1.5,2],[9000,2],[8192,8192]])assert.throws(()=>validateDimensions(...dims),/尺寸/);
});
test('native original download saves bytes without overwriting or escaping download folder',async()=>{
  const downloads=join(dir,'Downloads');
  const first=await downloadOriginalImage(dataURL,'../原图.png',downloads);
  const second=await downloadOriginalImage(dataURL,'../原图.png',downloads);
  assert.notEqual(first.savedPath,second.savedPath);assert.equal(first.savedPath.startsWith(downloads+'/'),true);
  assert.deepEqual(await readFile(first.savedPath),original);assert.deepEqual(await readFile(second.savedPath),original);
  await assert.rejects(downloadOriginalImage('http://example.invalid','bad',downloads),/格式无效/);
});
test('relayout validates aspect, retries same input, resamples exact size and prevents duplicate fill',async()=>{
  const job=await store.createImageActionJob(input());
  const source=await readFile(job.originalPath);assert.deepEqual(source,original);
  const invalid=join(dir,'wrong.png');await writeFile(invalid,picture());
  await assert.rejects(store.completeImageJob(job.id,invalid),/比例不符/);
  assert.equal((await store.readImageJob(job.id)).status,'failed');
  const retry=await store.retryImageJob(job.id);assert.equal(retry.attempts,1);assert.equal(retry.originalPath,job.originalPath);
  const correct=join(dir,'wide.png');await writeFile(correct,picture(8,4));
  await store.completeImageJob(job.id,correct);
  const result=await store.publicImageJob(job.id), output=decodePNG(Buffer.from(result.dataURL.split(',')[1],'base64'));
  assert.equal(output.width,16);assert.equal(output.height,8);
  assert.deepEqual(await readFile(job.originalPath),source);
  await assert.rejects(store.completeImageJob(job.id,correct),/不覆盖/);
  await assert.rejects(store.retryImageJob(job.id),/只有失败/);
});
test('background removal rejects opaque and empty results, accepts cropped dimensions without resampling',async()=>{
  const job=await store.createImageActionJob(input('remove-background',8,8));
  const file=join(dir,'cutout.png');await writeFile(file,picture());
  await assert.rejects(store.completeImageJob(job.id,file),/真实透明/);
  await store.retryImageJob(job.id);const empty=new PNG({width:8,height:8});empty.data.fill(0);await writeFile(file,PNG.sync.write(empty));
  await assert.rejects(store.completeImageJob(job.id,file),/有效主体/);
  await store.retryImageJob(job.id);const transparent=picture(3,6,true);await writeFile(file,transparent);
  await store.completeImageJob(job.id,file);const result=await store.publicImageJob(job.id);
  assert.equal(result.mimeType,'image/png');assert.deepEqual(Buffer.from(result.dataURL.split(',')[1],'base64'),transparent);
  assert.equal(result.width,3);assert.equal(result.height,6);assert.equal(result.ratio,'3:6');
  assert.equal(result.sourceWidth,8);assert.equal(result.sourceHeight,8);
});
test('invalid action input does not create a valid job',async()=>{
  await assert.rejects(store.createImageActionJob({...input(),kind:'bad'}),/无效/);
  const unconstrained=await store.createImageActionJob(input('remove-background',16,8));assert.equal(unconstrained.status,'queued');
  await assert.rejects(store.createImageActionJob({...input(),sourceImageId:''}),/来源图片/);
});
test('image actions sit above the image and clamp to viewport edges with zoom and rotation',()=>{
  const view={width:1000,height:700,scrollX:10,scrollY:20,zoom:{value:1}};
  assert.deepEqual(imageActionsPosition({x:300,y:300,width:200,height:200},view),{left:200,top:266});
  const left=imageActionsPosition({x:-100,y:-100,width:80,height:80},view);assert.equal(left.left,12);assert.equal(left.top,12);
  const right=imageActionsPosition({x:990,y:900,width:200,height:200},view);assert.equal(right.left,568);assert.equal(right.top,644);
  const zoomed=imageActionsPosition({x:300,y:300,width:200,height:200}, {...view,zoom:{value:2}});assert.equal(zoomed.left,568);assert.equal(zoomed.top,586);
  const rotated=imageActionsPosition({x:300,y:300,width:200,height:100,angle:Math.PI/2},view);assert.equal(rotated.top,216);
});
test('repeated results find empty space without moving or hiding prior images',()=>{
  const existing=[{x:100,y:100,width:400,height:400},{x:560,y:100,width:400,height:225}];
  const copy=JSON.stringify(existing);
  assert.deepEqual(nextImagePosition({x:560,y:100,width:400,height:400},existing),{x:1020,y:100});
  assert.equal(JSON.stringify(existing),copy);
});
