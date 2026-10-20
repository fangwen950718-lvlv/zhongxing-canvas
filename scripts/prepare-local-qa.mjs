// Dedicated native UI acceptance plugin and data. Never touches the user's scene.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { emptyProject } from '../src/project.ts';
const root=resolve('release/local-qa'),data=resolve('verification/local-2.1/native-data');
await cp(resolve('release/zhongxing-canvas'),root,{recursive:true});
for(const file of ['plugin.json','.codex-plugin/plugin.json']){
  const path=join(root,file),doc=JSON.parse(await readFile(path,'utf8'));doc.name='zhongxing-canvas-qa';
  const ui=doc.interface||doc.extensions?.['com.openai']?.interface;if(ui)ui.displayName='众行画布 · 隔离验收';
  await writeFile(path,JSON.stringify(doc,null,2));
}
for(const file of ['mcp.json','.mcp.json']){
  const path=join(root,file),doc=JSON.parse(await readFile(path,'utf8'));const server=doc.mcpServers.zhongxing_canvas;
  server.env={ZHONGXING_CANVAS_DATA_DIR:data};doc.mcpServers={zhongxing_canvas_qa:server};await writeFile(path,JSON.stringify(doc,null,2));
}
const marketFile=join(root,'.agents/plugins/marketplace.json'),market=JSON.parse(await readFile(marketFile,'utf8'));
market.name='zhongxing-local-qa';market.plugins[0].name='zhongxing-canvas-qa';await writeFile(marketFile,JSON.stringify(market,null,2));
const source=await readFile(resolve('verification/real-pipeline/generated.png'));
const p=emptyProject();p.name='本机 2.1 图片操作验收';p.scene.files={qa:{id:'qa',mimeType:'image/png',dataURL:`data:image/png;base64,${source.toString('base64')}`,created:Date.now()}};
p.scene.elements=[{id:'qa-source',type:'image',x:80,y:120,width:320,height:320,angle:0,strokeColor:'#1e1e1e',backgroundColor:'transparent',fillStyle:'solid',strokeWidth:1,strokeStyle:'solid',roughness:0,opacity:100,groupIds:[],frameId:null,index:'a0',roundness:null,seed:1,version:1,versionNonce:1,isDeleted:false,boundElements:null,updated:Date.now(),link:null,locked:false,fileId:'qa',status:'saved',scale:[1,1],crop:null}];
p.scene.appState={viewBackgroundColor:'#fafafa',scrollX:0,scrollY:0,zoom:{value:1}};
await mkdir(join(data,'projects'),{recursive:true});await writeFile(join(data,'projects/current.zhongxing.json'),JSON.stringify(p));
console.log(JSON.stringify({root,data}));
