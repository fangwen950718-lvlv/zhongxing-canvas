import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const stage = join(root, 'release', 'zhongxing-canvas');
await rm(stage, { recursive: true, force: true }); await mkdir(stage, { recursive: true });
const entries = ['plugin.json','mcp.json','.codex-plugin','.mcp.json','.agents','assets','skills','scripts/start-mcp.mjs','mcp/generated','README.md','LICENSE','THIRD_PARTY_NOTICES.md','licenses'];
for (const entry of entries) await cp(join(root, entry), join(stage, entry), { recursive: true, filter: file => !file.endsWith('/assets/widget.html') });
await writeFile(join(stage, 'package.json'), `${JSON.stringify({ name: 'zhongxing-canvas', version: pkg.version, private: true, type: 'module' }, null, 2)}\n`);
const zip = join(root, 'release', `zhongxing-canvas-v${pkg.version}.zip`);
await rm(zip, { force: true });
const result = spawnSync('zip', ['-qry', zip, 'zhongxing-canvas'], { cwd: join(root, 'release'), encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || 'zip failed');
console.log(zip);

