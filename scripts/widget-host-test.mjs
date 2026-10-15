// Test-only MCP Apps host. Uses the release MCP over stdio and deterministic
// fixtures to verify UI messages and result insertion without spending AI credits.
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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
    if (req.method === 'GET' && req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html><body style="margin:0"><iframe title="众行 MCP App 测试" style="border:0;width:100vw;height:100vh" sandbox="allow-scripts allow-same-origin allow-downloads allow-forms"></iframe><script type="module" src="/host.js"></script></body></html>'); return; }
    if (req.method === 'GET' && req.url === '/host.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bridgeJS); return; }
    if (req.method === 'GET' && req.url === '/widget') {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:; frame-src 'none'");
      res.end(html); return;
    }
    if (req.method === 'GET' && req.url === '/events') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ dataDir, events })); return; }
    if (req.method !== 'POST') { res.statusCode=404; res.end(); return; }
    let body=''; for await (const chunk of req) { body+=chunk; if (body.length>150_000_000) throw new Error('Test payload too large'); }
    const input=JSON.parse(body); res.setHeader('Content-Type','application/json');
    if (req.url === '/call') { events.push({type:'tool',name:input.name}); res.end(JSON.stringify(await client.callTool(input))); return; }
    if (req.url === '/message') {
      const text=input.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n') || '';
      const id=text.match(/[a-f0-9]{8}-[a-f0-9-]{27}/)?.[0];
      events.push({type:'message',id,text});
      if (!id) throw new Error('Task UUID missing');
      if (text.includes('zhongxing-canvas-brief')) {
        await client.callTool({name:'complete_zhongxing_brief_job',arguments:{id,options:[1,2,3].map(n=>({title:'测试方向 '+n,proposal:'确定性测试方案 '+n,sections:[{label:'创意主轴',content:'测试主体'},{label:'视觉主体',content:'单一物体'},{label:'构图层级',content:'主体居中'},{label:'风险提示',content:'仅为验收夹具'}],imagePrompt:'仅用于验收的测试图 '+n}))}});
      } else {
        await client.callTool({name:'start_zhongxing_image_job',arguments:{id}});
        await client.callTool({name:'complete_zhongxing_image_job',arguments:{id,file:fixture}});
      }
      res.end('{}'); return;
    }
    res.statusCode=404; res.end('{}');
  } catch(error) { res.statusCode=500; res.end(JSON.stringify({error:error.message})); }
});
http.listen(4330,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:4330/',dataDir,plugin:root})));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{http.close();await client.close();process.exit();});
