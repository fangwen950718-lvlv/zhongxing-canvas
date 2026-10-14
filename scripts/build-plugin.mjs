import { build } from 'esbuild';
import './build-widget.mjs';
import './collect-licenses.mjs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'mcp', 'generated');

await mkdir(outputDir, { recursive: true });
await build({
  entryPoints: [path.join(root, 'mcp', 'server.mjs')],
  outfile: path.join(outputDir, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  minify: true,
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const plugin = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
plugin.version = pkg.version;
await writeFile(path.join(root, 'plugin.json'), `${JSON.stringify(plugin, null, 2)}\n`);
const manifest = {
  name: 'zhongxing-canvas',
  displayName: '众行无限画布',
  version: pkg.version,
  mcp: 'zhongxing_canvas',
  widget: `ui://zhongxing-canvas/${pkg.version}/index.html`,
  builtAt: new Date().toISOString(),
  files: ['server.mjs', 'zhongxing-canvas-widget.html'],
};
await writeFile(path.join(outputDir, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await mkdir(path.join(root, '.codex-plugin'), { recursive: true });
const compatibility = { name: plugin.name, version: pkg.version, description: plugin.description, author: plugin.author, skills: './skills/', interface: plugin.extensions['com.openai'].interface, mcpServers: './.mcp.json' };
await writeFile(path.join(root, '.codex-plugin', 'plugin.json'), `${JSON.stringify(compatibility, null, 2)}\n`);
await copyFile(path.join(root, 'mcp.json'), path.join(root, '.mcp.json'));

console.log(`Built ${path.relative(root, path.join(outputDir, 'server.mjs'))}`);
