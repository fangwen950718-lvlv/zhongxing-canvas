import { copyFile, mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
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
let saveQueue=Promise.resolve();
export function saveProject(text){
  validate(text);
  const next=saveQueue.catch(()=>{}).then(()=>writeProject(text));saveQueue=next;return next;
}
async function writeProject(text) {
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `${randomUUID()}.tmp`);
  await writeFile(temporary, text, { mode: 0o600 });
  try { await copyFile(file, `${file}.bak`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rename(temporary, file);
}

// Copy the validated on-disk snapshot, rather than transporting its base64
// images through another large MCP message or a browser download sandbox.
export async function exportSavedProject(name,destination=process.env.ZHONGXING_CANVAS_DOWNLOAD_DIR||join(homedir(),'Downloads')){
  const size=(await stat(file)).size;if(!size||size>100*1024*1024)throw new Error('已保存项目为空或超过 100MB，请先检查保存状态');
  const safe=String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/^\.+/,'').slice(0,90)||'众行项目';
  await mkdir(destination,{recursive:true});
  for(let index=0;index<1000;index++){
    const savedPath=join(destination,`${safe}${index?` (${index+1})`:''}.zhongxing.json`);
    try{await copyFile(file,savedPath,constants.COPYFILE_EXCL);return {savedPath,bytes:(await stat(savedPath)).size};}
    catch(error){if(error.code!=='EEXIST')throw error;}
  }
  throw new Error('同名项目文件过多，请修改项目名称后重试');
}
