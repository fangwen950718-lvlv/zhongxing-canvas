import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const marketplace = 'zhongxing-canvas-github';
const plugin = `zhongxing-canvas@${marketplace}`;
const manifestUrl = 'https://raw.githubusercontent.com/fangwen950718-lvlv/zhongxing-canvas/main/plugin.json';
export function compareVersions(a,b) {
  const parse = value => { const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value); if (!match) throw new Error('版本号格式无效'); return [Number(match[1]),Number(match[2]),Number(match[3]),match[4]]; };
  const x=parse(a), y=parse(b);
  for (let i=0;i<3;i++) if(x[i]!==y[i]) return x[i]>y[i]?1:-1;
  return x[3]===y[3]?0:!x[3]?1:!y[3]?-1:String(x[3]).localeCompare(String(y[3]),undefined,{numeric:true});
}
export async function checkUpdate(current, fetchImpl=fetch) {
  const response=await fetchImpl(manifestUrl,{signal:AbortSignal.timeout(10000),headers:{'Accept':'application/json'},redirect:'error',cache:'no-store'});
  if(!response.ok)throw new Error(`版本检查失败（HTTP ${response.status}）`);
  const text=await response.text();if(text.length>100000)throw new Error('版本信息过大');
  const manifest=JSON.parse(text);if(manifest.name!=='zhongxing-canvas'||typeof manifest.version!=='string')throw new Error('版本信息无效');
  return {current,latest:manifest.version,available:compareVersions(manifest.version,current)>0};
}
export async function installUpdate(current) {
  const here=resolve(dirname(fileURLToPath(import.meta.url)),'..','..');
  let installed;try{installed=JSON.parse(await readFile(resolve(here,'.agents/plugins/marketplace.json'),'utf8'));}catch{}
  if(installed?.name !== marketplace) throw new Error('当前是本机测试版，请使用正式插件测试更新，未改动现有安装。');
  try {
    const expected=await checkUpdate(current);
    if(!expected.available)throw new Error('当前没有可安装的新正式版本');
    await run('codex',['plugin','marketplace','upgrade',marketplace,'--json'],{timeout:120000,maxBuffer:1024*1024});
    const result=await run('codex',['plugin','add',plugin,'--json'],{timeout:120000,maxBuffer:1024*1024});
    const installed=JSON.parse(result.stdout);
    if(installed.pluginId!==plugin || !installed.version || compareVersions(installed.version,expected.latest)<0)throw new Error('安装结果未达到检查到的新版本，请重新检查');
    return {version:installed.version,message:'更新命令已完成，请完全退出并重新打开 Codex，再新建对话验证版本。'};
  } catch(error) { throw new Error(`更新未确认完成：${error.message}。请检查网络与已安装版本，画布项目未被此操作删除。`); }
}
