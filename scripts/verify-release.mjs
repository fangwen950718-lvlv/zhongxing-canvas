import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginLaunchConfig } from './plugin-launch-config.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
await pluginLaunchConfig(root);
const required = ['plugin.json','mcp.json','.codex-plugin/plugin.json','.mcp.json','.agents/plugins/marketplace.json','scripts/start-mcp.mjs','mcp/generated/server.mjs','mcp/generated/zhongxing-canvas-widget.html','mcp/generated/release-manifest.json','README.md','LICENSE','THIRD_PARTY_NOTICES.md'];
for (const file of required) await access(join(root, file));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const plugin = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'));
const compat = JSON.parse(await readFile(join(root, '.codex-plugin/plugin.json'), 'utf8'));
const release = JSON.parse(await readFile(join(root, 'mcp/generated/release-manifest.json'), 'utf8'));
const marketplace = JSON.parse(await readFile(join(root, '.agents/plugins/marketplace.json'), 'utf8'));
if (![plugin.version, compat.version, release.version].every((version) => version === pkg.version)) throw new Error('Version mismatch');
if (marketplace.name !== 'zhongxing-canvas-github' || marketplace.plugins?.[0]?.name !== 'zhongxing-canvas') throw new Error('Marketplace identity mismatch');
const scanRoots = ['plugin.json','mcp.json','.codex-plugin','.mcp.json','.agents','assets','skills','scripts/start-mcp.mjs','mcp/generated','README.md','LICENSE','THIRD_PARTY_NOTICES.md','licenses'];
async function filesAt(target) { const stat = await import('node:fs/promises').then(({ stat }) => stat(target)); if (stat.isFile()) return [target]; const entries = await readdir(target, { withFileTypes: true }); return (await Promise.all(entries.map((entry) => filesAt(join(target, entry.name))))).flat(); }
const files = (await Promise.all(scanRoots.map((entry) => filesAt(join(root, entry))))).flat();
const forbidden = [/\/Users\/w\.fang/g, /127\.0\.0\.1:4318/g, /ZHONGXING_CANVAS_ROOT/g, /cowart_mcp/g, /plugins\/zhongxing-canvas\/mcp/g];
for (const file of files) {
  if (/\.(png|jpg|jpeg|webp|gif|woff2?)$/i.test(file)) continue;
  const text = await readFile(file, 'utf8');
  for (const pattern of forbidden) if (pattern.test(text)) throw new Error(`${relative(root, file)} contains forbidden ${pattern}`);
}
console.log(`OK: release ${pkg.version}, ${files.length} files checked.`);

