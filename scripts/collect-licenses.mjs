import { mkdir, readFile, readdir, copyFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const target = join(root, 'licenses', 'dependencies');
await mkdir(target, { recursive: true });
const inventory = [];
for (const [relative, info] of Object.entries(lock.packages)) {
  if (!relative.startsWith('node_modules/')) continue;
  const directory = join(root, relative);
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { continue; }
  const name = relative.replace(/^node_modules\//, '').replaceAll('/node_modules/', '--').replaceAll('/', '__');
  const notices = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^(licen[cs]e|copying|notice)(\.|-|$)/i.test(entry.name)) continue;
    const output = `${name}--${entry.name}`;
    await copyFile(join(directory, entry.name), join(target, output));
    notices.push(output);
  }
  inventory.push({ package: relative.replace(/^node_modules\//, ''), version: info.version, license: info.license || 'See package source', notices });
}
await writeFile(join(target, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`Collected ${inventory.length} dependency license records.`);
