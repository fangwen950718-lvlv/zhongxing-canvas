import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, '.widget-build');

await build({ configFile: path.join(root, 'vite.widget.config.ts') });

let html = await readFile(path.join(buildDir, 'index.html'), 'utf8');
const stylesheet = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/);
const script = html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/);
if (!stylesheet || !script) throw new Error('Widget build did not emit expected CSS and JS tags.');

const assetPath = (value) => path.join(buildDir, value.replace(/^\.\//, ''));
const css = await readFile(assetPath(stylesheet[1]), 'utf8');
let js = await readFile(assetPath(script[1]), 'utf8');
// Excalidraw dynamically loads font subsets via string URLs, outside Vite's
// static asset graph. Embed those files too so the MCP resource is offline.
const fontPaths = [...new Set([...js.matchAll(/(["'])(\.\/fonts\/[^"']+\.woff2)\1/g)].map(match => match[2]))];
for (const fontPath of fontPaths) {
  const bytes = await readFile(path.join(root, 'node_modules/@excalidraw/excalidraw/dist/prod', fontPath));
  js = js.replaceAll(fontPath, `data:font/woff2;base64,${bytes.toString('base64')}`);
}
if (/(["'])\.\/fonts\/[^"']+\.woff2\1/.test(js)) throw new Error('Unbundled font URL');
js = js.replace(/<\/script/gi, '<\\/script');
html = html
  .replace(stylesheet[0], () => `<style>${css}</style>`)
  .replace(script[0], () => `<script type="module">${js}</script>`)
  .replace(/<link[^>]+rel="modulepreload"[^>]*>/g, '');

const outputs = [
  path.join(root, 'mcp', 'generated', 'zhongxing-canvas-widget.html'),
];
for (const output of outputs) {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, html);
  console.log(`Built ${path.relative(root, output)} (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
}
