import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [pluginPath, originalFile, editedFile] = process.argv.slice(2).map(value => resolve(value));
if (!editedFile) throw new Error('Usage: node scripts/real-image-probe.mjs PLUGIN GENERATED_PNG EDITED_PNG');
const dataDir = await mkdtemp(join(tmpdir(), 'zhongxing-real-images-'));
const client = new Client({name:'real-image-probe',version:'2.0.0'});
await client.connect(new StdioClientTransport({command:process.execPath,args:['./scripts/start-mcp.mjs'],cwd:pluginPath,env:{...process.env,ZHONGXING_CANVAS_DATA_DIR:dataDir}}));
const bytes = await readFile(originalFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const originalHash = hash(bytes);
const dataURL = `data:image/png;base64,${bytes.toString('base64')}`;
const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
const call = async(name,args) => {
  const result=await client.callTool({name,arguments:args});
  if(result.isError) throw new Error(JSON.stringify(result.content));
  return result.structuredContent;
};
try {
  const generated = (await call('create_zhongxing_image_job',{prompt:'真实模型验收：橙色陶瓷立方体与绿色叶子',ratio:'1:1',referenceImages:[{name:'参考图.png',dataURL}]})).job;
  await call('start_zhongxing_image_job',{id:generated.id});
  await call('complete_zhongxing_image_job',{id:generated.id,file:originalFile});
  const output=(await call('get_zhongxing_image_job',{id:generated.id})).job;
  assert.equal(output.status,'completed'); assert.equal(output.dataURL,dataURL);
  const edit=(await call('create_zhongxing_image_edit_job',{prompt:'将橙色方块改为深蓝色，其他保持不变',ratio:`${width}:${height}`,width,height,originalDataURL:dataURL,annotatedDataURL:dataURL,referenceImages:[{name:'构图参考.png',dataURL}]})).job;
  await call('start_zhongxing_image_job',{id:edit.id});
  await call('complete_zhongxing_image_job',{id:edit.id,file:editedFile});
  const result=(await call('get_zhongxing_image_job',{id:edit.id})).job;
  assert.equal(result.status,'completed');
  assert.equal(hash(await readFile(edit.originalPath)),originalHash);
  assert.equal(hash(await readFile(originalFile)),originalHash);
  assert.notEqual(result.dataURL,dataURL);
  const duplicate=await client.callTool({name:'complete_zhongxing_image_job',arguments:{id:edit.id,file:originalFile}});
  assert.equal(duplicate.isError,true);
  const report={ok:true,generatedJob:generated.id,editJob:edit.id,width,height,referenceImagesStored:edit.referencePaths.length,originalPreserved:true,duplicateCompletionRejected:true,dataDir};
  await writeFile(join(dataDir,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { await client.close(); }
