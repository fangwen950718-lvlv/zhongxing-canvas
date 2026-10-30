// Test-only MCP Apps host. Uses the release MCP over stdio and deterministic
// fixtures to verify UI messages and result insertion without spending AI credits.
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {PNG} from 'pngjs';

const root = resolve(process.argv[2] || 'release/zhongxing-canvas');
const dataDir = process.env.ZHONGXING_TEST_DATA_DIR || await mkdtemp(join(tmpdir(), 'canvas-widget-host-'));
const fixture = join(dataDir, 'fixture.png');
await writeFile(fixture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6L8AAAAASUVORK5CYII=', 'base64'));
if (process.env.ZHONGXING_TEST_IMAGE) await cp(process.env.ZHONGXING_TEST_IMAGE, fixture);
const client = new Client({ name: 'widget-host-test', version: '2.0.0' }, { capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } } });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['./scripts/start-mcp.mjs'], cwd: root, env: { ...process.env, ZHONGXING_CANVAS_DATA_DIR: dataDir } }));
const opened = await client.callTool({name:'open_zhongxing_independent_canvas',arguments:{}});
const resource = await client.readResource({ uri: opened._meta['ui/resourceUri'] });
const html = resource.contents[0].text;
if (Buffer.byteLength(html) > 250_000) throw new Error('Refusing oversized UI resource in acceptance host');
const events = [];
let failedCreate=false;
const hostSource = `
import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
const frame=document.querySelector('iframe');
const bridge=new AppBridge(null,{name:'Release acceptance test',version:'1.0.0'},{serverTools:{},message:{text:{}}});
bridge.oncalltool=async params => (await fetch('/call',{method:'POST',body:JSON.stringify(params)})).json();
bridge.onmessage=async params => (await fetch('/message',{method:'POST',body:JSON.stringify(params)})).json();
bridge.onrequestdisplaymode=async ({mode}) => ({mode});
await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));
bridge.setHostContext({availableDisplayModes:['inline','fullscreen'],displayMode:'fullscreen'});
frame.src='/widget';
`;
const bundled = await build({ stdin: { contents: hostSource, resolveDir: process.cwd(), sourcefile: 'test-host.js' }, bundle: true, write: false, format: 'esm', platform: 'browser' });
const bridgeJS = bundled.outputFiles[0].text;
const http = createServer(async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html><body style="margin:0;overflow:hidden"><iframe title="众行 MCP App 测试" style="display:block;border:0;width:100%;height:100dvh" sandbox="allow-scripts allow-same-origin allow-downloads allow-forms"></iframe><script type="module" src="/host.js"></script></body></html>'); return; }
    if (req.method === 'GET' && req.url === '/host.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bridgeJS); return; }
    if (req.method === 'GET' && req.url === '/widget') {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:; frame-src 'none'");
      const fault=process.env.ZHONGXING_TEST_RECOVERY==='1'?`<script>const testButton=document.createElement('button');testButton.textContent='验收：模拟页面异常';testButton.style='position:fixed;right:16px;bottom:80px;z-index:999999';testButton.onclick=()=>window.dispatchEvent(new ErrorEvent('error',{error:new Error('Acceptance fixture'),message:'Acceptance fixture'}));document.body.append(testButton);</script>`:'';
      res.end(html.replace('</body>',fault+'</body>')); return;
    }
    if (req.method === 'GET' && req.url === '/events') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ dataDir, events })); return; }
    if (req.method !== 'POST') { res.statusCode=404; res.end(); return; }
    let body=''; for await (const chunk of req) { body+=chunk; if (body.length>150_000_000) throw new Error('Test payload too large'); }
    const input=JSON.parse(body); res.setHeader('Content-Type','application/json');
    if (req.url === '/call') {
      events.push({type:'tool',name:input.name});
      if(input.name==='create_zhongxing_image_job'){
        if(process.env.ZHONGXING_TEST_CREATE_DELAY_MS)await new Promise(resolve=>setTimeout(resolve,Math.min(20000,Number(process.env.ZHONGXING_TEST_CREATE_DELAY_MS)||0)));
        if(process.env.ZHONGXING_TEST_FAIL_CREATE_ONCE==='1'&&!failedCreate){failedCreate=true;res.end(JSON.stringify({isError:true,content:[{type:'text',text:'验收夹具：模拟任务创建失败，未创建服务器任务'}]}));return;}
      }
      res.end(JSON.stringify(await client.callTool(input)));return;
    }
    if (req.url === '/message') {
      const text=input.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n') || '';
      const id=text.match(/[a-f0-9]{8}-[a-f0-9-]{27}/)?.[0];
      events.push({type:'message',id,text});
      if (!id) throw new Error('Task UUID missing');
      if (text.includes('zhongxing-canvas-brief')) {
        await client.callTool({name:'complete_zhongxing_brief_job',arguments:{id,options:[1,2,3].map(n=>({title:'测试方向 '+n,proposal:'确定性测试方案 '+n,sections:[{label:'创意主轴',content:'测试主体'},{label:'视觉主体',content:'单一物体'},{label:'构图层级',content:'主体居中'},{label:'风险提示',content:'仅为验收夹具'}],imagePrompt:'仅用于验收的测试图 '+n}))}});
      } else if (text.includes('zhongxing-canvas-reference')) {
        for (let index=0;index<3;index++) {
          const result=await client.callTool({name:'save_zhongxing_op_references',arguments:{id,index,references:[{title:`验收参考 ${index+1}`,source:'测试夹具',pageUrl:`https://example.com/op-${index+1}`,previewFile:fixture,description:'仅用于验证显示与回填'}]}});
          if(result.isError)throw new Error(JSON.stringify(result));
        }
        events.push({type:'mock-references-completed',id});
      } else {
        const loaded=await client.callTool({name:'get_zhongxing_image_job',arguments:{id}});
        if(loaded.structuredContent.job.upscaleMode==='tiled'){
          // Explicit deterministic UI fixture, not evidence of AI reconstruction.
          for(const tile of loaded.structuredContent.job.tiles){
            if(tile.status==='completed')continue;
            const started=await client.callTool({name:'start_zhongxing_upscale_tile',arguments:{id,index:tile.index}});
            if(started.isError)throw new Error(JSON.stringify(started));
            const input=started.structuredContent.tile,crop=PNG.sync.read(await readFile(input.cropPath)),mock=new PNG({width:992,height:992});
            for(let y=0;y<992;y++)for(let x=0;x<992;x++){const at=(Math.floor(y*crop.height/992)*crop.width+Math.floor(x*crop.width/992))*4;crop.data.copy(mock.data,(y*992+x)*4,at,at+4);}
            const file=join(dataDir,`mock-tile-${tile.index}.png`);await writeFile(file,PNG.sync.write(mock));
            const result=await client.callTool({name:'complete_zhongxing_upscale_tile',arguments:{id,index:tile.index,token:input.token,file}});if(result.isError)throw new Error(JSON.stringify(result));
          }
          const result=await client.callTool({name:'finish_zhongxing_upscale_tiles',arguments:{id}});if(result.isError)throw new Error(JSON.stringify(result));
          events.push({type:'mock-tiles-completed',id});res.end('{}');return;
        }
        await client.callTool({name:'start_zhongxing_image_job',arguments:{id}});
        let result=fixture;
        if(process.env.ZHONGXING_TEST_RESULTS_DIR) {
          const response=await client.callTool({name:'get_zhongxing_image_job',arguments:{id}});
          const job=response.structuredContent.job;
          if(job.kind==='remove-background') result=join(process.env.ZHONGXING_TEST_RESULTS_DIR,'cutout.png');
          if(job.kind==='upscale') result=join(process.env.ZHONGXING_TEST_RESULTS_DIR,job.upscaleMode==='whole-resample'?'hd-native.png':'hd.png');
          if(job.kind==='relayout') result=join(process.env.ZHONGXING_TEST_RESULTS_DIR,job.width>job.height?'wide.png':'portrait.png');
        }
        const completed=await client.callTool({name:'complete_zhongxing_image_job',arguments:{id,file:result}});
        if(completed.isError)throw new Error(completed.content?.find(c=>c.type==='text')?.text||'Test result rejected');
      }
      res.end('{}'); return;
    }
    res.statusCode=404; res.end('{}');
  } catch(error) { res.statusCode=500; res.end(JSON.stringify({error:error.message})); }
});
http.listen(4330,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:4330/',dataDir,plugin:root})));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{http.close();await client.close();process.exit();});
