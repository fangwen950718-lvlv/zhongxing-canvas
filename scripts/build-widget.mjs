import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { build as bundle } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, '.widget-build');

await build({ configFile: path.join(root, 'vite.widget.config.ts') });

let html = await readFile(path.join(buildDir, 'index.html'), 'utf8');
const stylesheet = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/);
const script = html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/);
if (!stylesheet || !script) throw new Error('Widget build did not emit expected CSS and JS tags.');

const assetPath = (value) => path.join(buildDir, value.replace(/^\.\//, ''));
const css = await readFile(assetPath(stylesheet[1]));
let js = await readFile(assetPath(script[1]), 'utf8');
const outputDir = path.join(root, 'mcp/generated');
const assetDir = path.join(outputDir, 'assets');
await rm(assetDir, { recursive: true, force: true });
const manifest = {};
async function asset(id, bytes, mimeType, encoding = 'identity') {
  await mkdir(path.dirname(path.join(assetDir, id)), { recursive: true });
  await writeFile(path.join(assetDir, id), bytes);
  manifest[id] = { file: id, bytes: bytes.length, mimeType, encoding, sha256: createHash('sha256').update(bytes).digest('hex') };
}
// Keep editor/font bytes intact; move the large payload behind bounded MCP reads.
const fontPaths = [...new Set([...js.matchAll(/(["'])(\.\/fonts\/[^"']+\.woff2)\1/g)].map(match => match[2]))];
for (const fontPath of fontPaths) {
  const bytes = await readFile(path.join(root, 'node_modules/@excalidraw/excalidraw/dist/prod', fontPath));
  js = js.replaceAll(fontPath, `data:font/woff2;base64,${bytes.toString('base64')}`);
}
if (/(["'])\.\/fonts\/[^"']+\.woff2\1/.test(js)) throw new Error('Unbundled font URL');
await asset('application.js.gz', gzipSync(Buffer.from(js), { level: 9 }), 'text/javascript', 'gzip');
await asset('application.css.gz', gzipSync(css, { level: 9 }), 'text/css', 'gzip');
await writeFile(path.join(outputDir, 'asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const boot = await bundle({ entryPoints: [path.join(root, 'src/widgetBootstrap.ts')], bundle: true, write: false, minify: true, format: 'iife', platform: 'browser', target: 'chrome110' });
const bootGzip = gzipSync(Buffer.from(boot.outputFiles[0].text), { level: 9 }).toString('base64');
const bootJS = `(async()=>{try{const bytes=Uint8Array.from(atob('${bootGzip}'),c=>c.charCodeAt(0));const source=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));try{await import(url)}finally{URL.revokeObjectURL(url)}}catch(e){document.getElementById('boot-error').textContent='画布启动失败：'+e.message;document.getElementById('boot-retry').hidden=false;document.getElementById('boot-retry').onclick=()=>location.reload()}})();`;
html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>众行无限画布</title><style>html,body{margin:0;height:100%;font-family:system-ui,sans-serif;background:#fafafa;color:#333333}#boot{padding:32px}#boot button{padding:10px 20px;border:1px solid #dedede;border-radius:8px;background:white;cursor:pointer}#boot-error{white-space:pre-wrap;color:#555555}#root{height:100%}</style></head><body><div id="boot"><h2>众行无限画布</h2><p id="boot-status">正在连接画布…</p><progress id="boot-progress" max="100" value="0"></progress><p id="boot-error" role="alert"></p><button id="boot-retry" hidden>重新加载</button></div><div id="root"></div><script>${bootJS}</script></body></html>`;
if (Buffer.byteLength(html) > 250_000) throw new Error('Widget entry exceeds 250 KB release budget');

const outputs = [
  path.join(root, 'mcp', 'generated', 'zhongxing-canvas-widget.html'),
];
for (const output of outputs) {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, html);
  console.log(`Built ${path.relative(root, output)} (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
}
