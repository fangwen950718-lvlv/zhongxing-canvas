import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {makeUpscaleGuides} from '../mcp/runtime/upscale-guides.mjs';
import {createSceneSignature} from '../src/sceneSignature';
import {actionPrompt,commandForImageJob,imageActionFrame,pngPixelSize} from '../src/imageActionUtils';
const dir=await mkdtemp(join(tmpdir(),'zx-smart-hd-'));process.env.ZHONGXING_CANVAS_DATA_DIR=dir;
const store=await import('../mcp/runtime/job-store.mjs');
function picture(w:number,h:number){const p=new PNG({width:w,height:h});p.data.fill(255);for(let i=0;i<p.data.length/2;i+=4)p.data[i]=30;return PNG.sync.write(p);}
const original=picture(16,8);
test('PNG dimension info reads only the header without decoding a full bitmap',()=>{
  assert.deepEqual(pngPixelSize(`data:image/png;base64,${original.toString('base64')}`),{width:16,height:8});
  assert.equal(pngPixelSize('data:image/png;base64,broken'),undefined);
  assert.equal(pngPixelSize('data:image/jpeg;base64,/9j/'),undefined);
});
test('smart HD preserves source, produces three bounded guides, and rejects fake low-resolution success',async()=>{
  for(const factor of [2,4]){
    const job=await store.createImageActionJob({kind:'upscale',sourceImageId:'original',sourceWidth:16,sourceHeight:8,width:16*factor,height:8*factor,originalDataURL:`data:image/png;base64,${original.toString('base64')}`,prompt:actionPrompt('upscale',16*factor,8*factor)});
    assert.deepEqual(await readFile(job.originalPath),original);assert.equal(job.scale,factor);
    for(const file of Object.values(job.guidePaths)){const guide=PNG.sync.read(await readFile(file as string));assert(guide.width<=1024);}
    const low=join(dir,`${job.id}-low.png`);await writeFile(low,original);
    await assert.rejects(store.completeImageJob(job.id,low),/分辨率不足/);
    await store.retryImageJob(job.id);
    const full=join(dir,`${job.id}-full.png`),output=picture(16*factor,8*factor);await writeFile(full,output);
    await store.completeImageJob(job.id,full);assert.equal((await store.readImageJob(job.id)).status,'completed');
    await assert.rejects(store.completeImageJob(job.id,full),/不覆盖/);
  }
  assert.match(commandForImageJob({id:'test',kind:'upscale'} as any),/image-action/);
  assert.deepEqual(imageActionFrame({width:3000,height:2000}),{width:3000,height:2000});
});
test('guides retain white and are not upscaled final artwork',()=>{
  const guides=makeUpscaleGuides(picture(2048,1024));
  const color=PNG.sync.read(guides.color);assert.equal(color.width,1024);assert.equal(color.height,512);
  assert.equal(color.data[color.data.length-2],255);
});
test('scene signature tracks changed image content without serializing base64 during pan',()=>{
  const signature=createSceneSignature();const files={a:{dataURL:'data:image/png;base64,'+'A'.repeat(1_000_000),mimeType:'image/png',created:1}};
  const a=signature([],{},files),b=signature([],{},files);assert.equal(a,b);assert(a.length<100);
  const pan=signature([],{scrollX:20},files);assert.notEqual(a,pan);
  files.a.dataURL='replacement';assert.notEqual(signature([],{},files),a);
  assert.notEqual(signature([],{},{}),a);
});
