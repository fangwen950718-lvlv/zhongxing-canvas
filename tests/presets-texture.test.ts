import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {promptPresets,composePreset,fillSkeleton} from '../src/promptPresets';
import {texturePreservingUpscale} from '../mcp/runtime/texture-upscale.mjs';
process.env.ZHONGXING_CANVAS_DATA_DIR=await mkdtemp(join(tmpdir(),'canvas-presets-texture-'));
const store=await import('../mcp/runtime/job-store.mjs');
const projects=await import('../mcp/runtime/projects.mjs');
test('concurrent saves and recovery checkpoint writes are serialized in order',async()=>{
  const p={format:'zhongxing-canvas',version:1,brief:{},scene:{elements:[],files:{}},name:'older'};
  await Promise.all([projects.saveProject(JSON.stringify(p)),projects.saveProject(JSON.stringify({...p,name:'newer'})),projects.saveProject(JSON.stringify({...p,name:'recovery checkpoint'}))]);
  assert.equal(JSON.parse(await projects.loadProject()).name,'recovery checkpoint');
  assert.throws(()=>projects.saveProject('{bad'));
  await projects.saveProject(JSON.stringify({...p,name:'after rejection'}));assert.equal(JSON.parse(await projects.loadProject()).name,'after rejection');
});
test('five texture presets have seven content fields, editable variables, and no unresolved default placeholders',async()=>{
  assert.equal(promptPresets.length,5);
  for(const p of promptPresets){for(const key of ['name','applicable','skeleton','negative','referenceAndParameters','example','scenario'])assert(p[key]);
    const result=composePreset(p,p.skeleton,p.negative,p.variables,'现有方案：保留标题“夏日”与包装',false);
    assert(result.includes('保留标题“夏日”与包装'));assert(!/\{[^{}]+\}/.test(result));
    assert((await readFile(new URL(`../assets/preset-examples/${p.example}.png`,import.meta.url))).length>100);
  }
  assert.equal(fillSkeleton('{人物} {服饰}',{人物:'小王'}),'小王');
});
test('generation task persists chosen texture and full aesthetic rules separately',async()=>{
  const job=await store.createImageJob({prompt:'现有方案与质感',ratio:'1:1',presetId:'real',ruleLabel:'人物海报',ruleText:'完整审美正文\n不改人物身份'});
  const saved=await store.readImageJob(job.id);assert.equal(saved.presetId,'real');assert.equal(saved.ruleText,'完整审美正文\n不改人物身份');
  await assert.rejects(store.createImageJob({prompt:'测试',ratio:'1:1',presetId:'unknown'}));
});
function source(){const p=new PNG({width:16,height:12});for(let y=0;y<12;y++)for(let x=0;x<16;x++){const n=(y*16+x)*4;for(let c=0;c<3;c++)p.data[n+c]=x<8?60:200;p.data[n+3]=255;}return PNG.sync.write(p);}
test('non-generative x2/x4 has no ringing overshoot, creates no texture in constant patches and preserves alpha',()=>{
  const bytes=source();for(const factor of [2,4]){const r=texturePreservingUpscale(bytes,16*factor,12*factor),p=PNG.sync.read(r.bytes);assert.equal(p.width,16*factor);assert.equal(r.quality.generated,false);
    for(let i=0;i<p.data.length;i+=4){assert(p.data[i]>=60&&p.data[i]<=200);assert.equal(p.data[i+3],255);}
    assert.equal(p.data[(factor*3*p.width+factor*3)*4],60);
  }
  const transparent=new PNG({width:2,height:1});transparent.data.set([255,0,0,255,0,255,0,0]);const p=PNG.sync.read(texturePreservingUpscale(PNG.sync.write(transparent),8,4).bytes);for(let i=0;i<p.data.length;i+=4)if(p.data[i+3]>0){assert.equal(p.data[i],255);assert.equal(p.data[i+1],0);}
});
test('local HD completes without guide or model call and retains source bytes; duplicate completion is rejected',async()=>{
  const bytes=source();const job=await store.createImageActionJob({kind:'upscale',upscaleMode:'texture-preserve',prompt:'本地放大',sourceImageId:'fixture',sourceWidth:16,sourceHeight:12,width:64,height:48,originalDataURL:`data:image/png;base64,${bytes.toString('base64')}`});
  assert.equal(job.status,'completed');assert.equal(job.guidePaths,undefined);assert.equal(job.quality.generated,false);assert((await readFile(job.originalPath)).equals(bytes));
  const result=await store.publicImageJob(job.id);assert.equal(PNG.sync.read(Buffer.from(result.dataURL.split(',')[1],'base64')).width,64);
  await assert.rejects(store.completeImageJob(job.id,job.originalPath));
});
