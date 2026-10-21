import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {planUpscaleTiles,TILE_SIZE} from '../mcp/runtime/tile-plan.mjs';
import {tileReference,stitchTiles,normalizeTile} from '../mcp/runtime/tiled-upscale.mjs';
const dir=await mkdtemp(join(tmpdir(),'zx-tiles-'));process.env.ZHONGXING_CANVAS_DATA_DIR=dir;
const store=await import('../mcp/runtime/job-store.mjs');
function png(w:number,h:number,alpha=255){const p=new PNG({width:w,height:h});for(let i=0;i<p.data.length;i+=4){p.data[i]=80;p.data[i+1]=120;p.data[i+2]=160;p.data[i+3]=alpha;}return PNG.sync.write(p);}
const source=png(896,448),file=join(dir,'native.png');await writeFile(file,png(1024,1024));
async function job(){return store.createImageActionJob({kind:'upscale',upscaleMode:'tiled',sourceImageId:'test',sourceWidth:896,sourceHeight:448,width:1792,height:896,prompt:'保留构图',originalDataURL:`data:image/png;base64,${source.toString('base64')}`});}
test('4K plan uses 15 overlapping tiles and bounds work before generation',()=>{
  const tiles=planUpscaleTiles(3840,2160);assert.equal(tiles.length,15);assert.equal(tiles[0].inputX,-48);assert.equal(tiles[14].width,256);
  assert.throws(()=>planUpscaleTiles(7680,4320),/900 万/);assert.throws(()=>planUpscaleTiles(8192,1000),/上限/);
  assert.throws(()=>normalizeTile(png(800,800)),/分辨率不足/);assert.throws(()=>normalizeTile(png(1024,768)),/比例/);
});
test('crop is source-resolution, not a fabricated HD result',()=>{
  const crop=PNG.sync.read(tileReference(source,2,planUpscaleTiles(1792,896)[0]));assert.equal(crop.width,496);assert.equal(crop.height,496);assert.equal(crop.data[0],80);
});
test('4K stitch covers all pixels, preserves alpha and has no holes',()=>{
  const tiles=planUpscaleTiles(3840,2160),tile=png(TILE_SIZE,TILE_SIZE,128);
  const output=PNG.sync.read(stitchTiles(3840,2160,tiles,tiles.map(()=>tile)));
  assert.equal(output.width,3840);assert.equal(output.height,2160);
  for(let i=0;i<output.data.length;i+=4){assert.equal(output.data[i],80);assert.equal(output.data[i+3],128);}
  assert.throws(()=>stitchTiles(3840,2160,tiles,[tile]),/缺少/);
});
test('tile lifecycle rejects partial and duplicate completion; resume retains successful tiles',async()=>{
  const j=await job();await assert.rejects(store.finishUpscaleTiles(j.id),/未完成/);
  await assert.rejects(store.completeImageJob(j.id,file),/逐块/);
  const first=await store.startUpscaleTile(j.id,0);await store.completeUpscaleTile(j.id,0,first.token,file);
  await assert.rejects(store.completeUpscaleTile(j.id,0,first.token,file),/失效/);
  await store.setImageJobState(j.id,'failed','模拟中断');await store.retryImageJob(j.id);
  assert.equal((await store.readImageJob(j.id)).tiles[0].status,'completed');
  const second=await store.startUpscaleTile(j.id,1);await store.completeUpscaleTile(j.id,1,second.token,file);
  const result=await store.finishUpscaleTiles(j.id);assert.equal(result.status,'completed');
  const restored=PNG.sync.read(await readFile(join(dir,'images',result.imageName)));assert.equal(restored.width,1792);assert.equal(restored.height,896);
  assert.deepEqual(await readFile(j.originalPath),source);await assert.rejects(store.finishUpscaleTiles(j.id),/结束/);
});
test('cancel prevents late write; retries are bounded per tile',async()=>{
  const j=await job(),tile=await store.startUpscaleTile(j.id,0);await store.cancelImageJob(j.id);
  await assert.rejects(store.completeUpscaleTile(j.id,0,tile.token,file),/结束/);await assert.rejects(store.retryImageJob(j.id),/失败/);
  const another=await job();for(let i=0;i<2;i++){await store.startUpscaleTile(another.id,0);await store.setImageJobState(another.id,'failed','模拟模型失败');await store.retryImageJob(another.id);}
  await assert.rejects(store.startUpscaleTile(another.id,0),/预算/);
});
test('additional retries are bounded across the entire job, not per tile only',async()=>{
  const bytes=png(512,512),j=await store.createImageActionJob({kind:'upscale',upscaleMode:'tiled',sourceImageId:'budget',sourceWidth:512,sourceHeight:512,width:2048,height:2048,prompt:'预算测试',originalDataURL:`data:image/png;base64,${bytes.toString('base64')}`});
  for(let index=0;index<2;index++){
    const old=await store.startUpscaleTile(j.id,index);await store.setImageJobState(j.id,'failed','模拟失败');await store.retryImageJob(j.id);
    const current=await store.startUpscaleTile(j.id,index);
    await assert.rejects(store.completeUpscaleTile(j.id,index,old.token,file),/失效/);
    await store.completeUpscaleTile(j.id,index,current.token,file);
  }
  await store.startUpscaleTile(j.id,2);await store.setImageJobState(j.id,'failed','模拟失败');await store.retryImageJob(j.id);
  await assert.rejects(store.startUpscaleTile(j.id,2),/预算/);
});
