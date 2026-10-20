// Reuses real AI outputs supplied as files; does not pretend to invoke a model.
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PNG } from 'pngjs';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]||'release/zhongxing-canvas');
const outputs=resolve(process.argv[3]||'verification/local-2.1');
const source=await readFile(resolve('verification/real-pipeline/generated.png'));
const original=PNG.sync.read(source);
const data=await mkdtemp(join(tmpdir(),'zhongxing-image-action-acceptance-'));
const client=new Client({name:'real-output-acceptance',version:'1.0.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:['scripts/start-mcp.mjs'],cwd:root,env:{...process.env,ZHONGXING_CANVAS_DATA_DIR:data}}));
async function call(name,args){const r=await client.callTool({name,arguments:args});if(r.isError)throw new Error(r.content.find(c=>c.type==='text')?.text||'MCP error');return r.structuredContent;}
const results=[];
try{
  for(const [kind,name,width,height] of [['relayout','wide',1536,864],['relayout','portrait',768,1024],['remove-background','cutout',original.width,original.height]]){
    const {job}=await call('create_zhongxing_image_action_job',{kind,sourceImageId:'qa-source',sourceWidth:original.width,sourceHeight:original.height,width,height,prompt:`验收 ${name}`,originalDataURL:`data:image/png;base64,${source.toString('base64')}`});
    await call('start_zhongxing_image_job',{id:job.id});
    await call('complete_zhongxing_image_job',{id:job.id,file:join(outputs,`${name}.png`)});
    const completed=await call('get_zhongxing_image_job',{id:job.id});
    const bytes=Buffer.from(completed.job.dataURL.split(',')[1],'base64'),png=PNG.sync.read(bytes);
    if(kind==='remove-background'){
      assert.deepEqual(bytes,await readFile(join(outputs,`${name}.png`)));
      assert.equal(completed.job.width,png.width);assert.equal(completed.job.height,png.height);
    }else{assert.equal(png.width,width);assert.equal(png.height,height);}
    assert.deepEqual(await readFile(job.originalPath),source);
    await writeFile(join(outputs,`${name}-final.png`),bytes);
    results.push({kind,id:job.id,width:png.width,height:png.height,originalPreserved:true,verified:true});
  }
  await mkdir(outputs,{recursive:true});await writeFile(join(outputs,'real-output-results.json'),JSON.stringify({dataDirectory:data,results},null,2));
  console.log(JSON.stringify({dataDirectory:data,results},null,2));
}finally{await client.close();}
