import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getUserDataRoot } from './data-dir.mjs';

const directory = join(getUserDataRoot(), 'projects');
const file = join(directory, 'current.zhongxing.json');
function validate(text) {
  if (Buffer.byteLength(text, 'utf8') > 100 * 1024 * 1024) throw new Error('项目超过 100MB');
  const project = JSON.parse(text);
  if (project?.format !== 'zhongxing-canvas' || project.version !== 1 || typeof project.name !== 'string' || !project.brief || !Array.isArray(project.scene?.elements) || !project.scene.files || typeof project.scene.files !== 'object') throw new Error('项目格式无效，原记录未覆盖');
  return text;
}
export async function loadProject() {
  try { return validate(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function saveProject(text) {
  validate(text);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `${randomUUID()}.tmp`);
  await writeFile(temporary, text, { mode: 0o600 });
  try { await copyFile(file, `${file}.bak`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rename(temporary, file);
}
