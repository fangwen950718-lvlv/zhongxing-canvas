import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PNG} from 'pngjs';
import {emptyProject,parseProject} from '../src/project';
import {makeUpscaleGuides} from '../mcp/runtime/upscale-guides.mjs';
const dir=await mkdtemp(join(tmpdir(),'zx-export-'));process.env.ZHONGXING_CANVAS_DATA_DIR=join(dir,'data');
const store=await import('../mcp/runtime/projects.mjs');
test('disk project export preserves a large valid project exactly without overwriting previous backups',async()=>{
  const project=emptyProject();project.name='分组项目';project.creativeBrief='测试方案与图片历史';
  // Many valid PNG files simulate a 30+ MB image-heavy project, not oversized brief text.
  const p=new PNG({width:256,height:256});let seed=123;
  for(let i=0;i<p.data.length;i+=4){for(let c=0;c<3;c++){seed=(seed*1664525+1013904223)>>>0;p.data[i+c]=seed>>>24;}p.data[i+3]=255;}
  const dataURL=`data:image/png;base64,${PNG.sync.write(p).toString('base64')}`;
  for(let i=0;i<125;i++){const id=`image-${i}`;project.scene.files[id]={id,mimeType:'image/png',created:Date.now(),dataURL} as any;}
  const text=JSON.stringify(project);assert(Buffer.byteLength(text)>30*1024*1024);
  await store.saveProject(text);const downloads=join(dir,'downloads');
  const first=await store.exportSavedProject('../分组项目',downloads),second=await store.exportSavedProject('../分组项目',downloads);
  assert.notEqual(first.savedPath,second.savedPath);assert(first.savedPath.startsWith(downloads+'/'));
  const bytes=await readFile(first.savedPath);assert.equal(bytes.toString(),text);assert.equal(first.bytes,bytes.length);
  const imported=parseProject(JSON.parse(bytes.toString()));assert.equal(Object.keys(imported.scene.files).length,125);assert.equal(imported.creativeBrief,project.creativeBrief);
  assert.equal((await readFile(second.savedPath)).toString(),text);
  assert.equal(await store.loadProject(),text);
  const blocked=join(dir,'not-directory');await mkdir(blocked);await assert.rejects(store.exportSavedProject('项目',join(first.savedPath,'child')));
});
test('coarse structure guides suppress fine defects but retain main object outlines',()=>{
  const p=new PNG({width:1024,height:512});
  for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){
    const inside=x>220&&x<800&&y>90&&y<420;
    const fine=inside&&((x+Math.round(3*Math.sin(y/5)))%12<2);
    const v=inside?(fine?70:160):245,at=(y*p.width+x)*4;p.data[at]=p.data[at+1]=p.data[at+2]=v;p.data[at+3]=255;
  }
  const guides=makeUpscaleGuides(PNG.sync.write(p)),line=PNG.sync.read(guides.line);let dark=0,total=0,outline=0;
  for(let y=140;y<370;y++)for(let x=280;x<740;x++){total++;if(line.data[(y*line.width+x)*4]<128)dark++;}
  for(let y=85;y<425;y++)for(let x=200;x<240;x++)if(line.data[(y*line.width+x)*4]<128)outline++;
  assert(dark/total<.01,`fine defects remaining ${dark/total}`);assert(outline>100,'main outline must remain');
  assert.equal(line.width,1024);assert.equal(line.height,512);
});
