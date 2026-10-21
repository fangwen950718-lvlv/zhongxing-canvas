import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PNG} from 'pngjs';
import {normalizeImageOutput} from '../mcp/runtime/image-output.mjs';
import {resampleLanczos} from '../mcp/runtime/resample.mjs';
const dir=await mkdtemp(join(tmpdir(),'zx-whole-hd-'));process.env.ZHONGXING_CANVAS_DATA_DIR=dir;
const store=await import('../mcp/runtime/job-store.mjs');
function png(w:number,h:number,color=90){const p=new PNG({width:w,height:h});for(let i=0;i<p.data.length;i+=4){p.data[i]=color;p.data[i+1]=110;p.data[i+2]=150;p.data[i+3]=255;}return PNG.sync.write(p);}
test('whole-frame path accepts native 1672×941 and outputs exact 4K, legacy path stays strict',()=>{
  const native=png(1672,941),base={kind:'upscale',width:3840,height:2160};
  const result=PNG.sync.read(normalizeImageOutput({...base,upscaleMode:'whole-resample'},native));
  assert.equal(result.width,3840);assert.equal(result.height,2160);
  for(const x of [0,960,1920,2879,3839])for(const y of [0,540,1080,1619,2159]){const at=(y*3840+x)*4;assert.deepEqual([...result.data.subarray(at,at+4)],[90,110,150,255]);}
  assert.throws(()=>normalizeImageOutput(base,native),/分辨率不足/);
  assert.throws(()=>normalizeImageOutput({...base,upscaleMode:'whole-resample'},png(800,800)),/比例/);
  assert.throws(()=>normalizeImageOutput({...base,upscaleMode:'whole-resample'},png(160,90)),/过小/);
});
test('Lanczos uses premultiplied alpha, without dark/colored transparent fringes',()=>{
  const input=new PNG({width:2,height:1});input.data.set([255,0,0,255,0,255,0,0]);
  const output=PNG.sync.read(resampleLanczos(input,16,8));
  let transition=false;for(let i=0;i<output.data.length;i+=4)if(output.data[i+3]>0){assert.equal(output.data[i],255);assert.equal(output.data[i+1],0);transition||=output.data[i+3]<255;}
  assert(transition);
  const down=PNG.sync.read(resampleLanczos(PNG.sync.read(png(96,48)),12,6));assert.equal(down.width,12);assert.equal(down.data[0],90);
});
test('whole-frame task retains native file, source, processing metadata and duplicate guard for ×2/×4',async()=>{
  const source=png(512,256),native=png(1024,512,95),file=join(dir,'native.png');await writeFile(file,native);
  for(const factor of [2,4]){
    const j=await store.createImageActionJob({kind:'upscale',upscaleMode:'whole-resample',sourceImageId:'source',sourceWidth:512,sourceHeight:256,width:512*factor,height:256*factor,originalDataURL:`data:image/png;base64,${source.toString('base64')}`,prompt:'整图修复'});
    assert.equal(j.tiles,undefined);assert.equal(j.upscaleMode,'whole-resample');
    await assert.rejects(store.completeImageJob(j.id,j.originalPath),/不能直接放大/);
    await store.setImageJobState(j.id,'running','整图修复中');
    const done=await store.completeImageJob(j.id,file);
    assert.equal(done.processing.nativeWidth,1024);assert.equal(done.processing.targetWidth,512*factor);
    assert.deepEqual(await readFile(join(dir,'images',done.processing.nativeImageName)),native);
    assert.deepEqual(await readFile(j.originalPath),source);
    const final=PNG.sync.read(await readFile(join(dir,'images',done.imageName)));assert.equal(final.width,512*factor);
    await assert.rejects(store.completeImageJob(j.id,file),/不覆盖/);
  }
});
test('whole-frame wrong aspect fails recoverably with original input retained',async()=>{
  const source=png(512,256),j=await store.createImageActionJob({kind:'upscale',upscaleMode:'whole-resample',sourceImageId:'source',sourceWidth:512,sourceHeight:256,width:1024,height:512,originalDataURL:`data:image/png;base64,${source.toString('base64')}`,prompt:'整图修复'});
  const file=join(dir,'square.png');await writeFile(file,png(800,800));await assert.rejects(store.completeImageJob(j.id,file),/比例/);
  assert.equal((await store.readImageJob(j.id)).status,'failed');await store.retryImageJob(j.id);assert.deepEqual(await readFile(j.originalPath),source);
});
