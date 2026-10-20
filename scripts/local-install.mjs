// Local-only installation. No git/network publication or removal of user data.
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getUserDataRoot } from '../mcp/runtime/data-dir.mjs';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url));
const codeHome=process.env.CODEX_HOME||join(homedir(),'.codex');
const stateFile=join(root,'verification/local-2.1/install-state.json');
const localId='zhongxing-canvas@zhongxing-canvas-local', publicId='zhongxing-canvas@zhongxing-canvas-github';
function command(args){const p=spawnSync('codex',args,{encoding:'utf8'});if(p.status!==0)throw new Error(p.stderr||p.stdout);return JSON.parse(p.stdout);}
async function flags(local,publicEnabled){
  const p=spawn('codex',['app-server','--stdio'],{stdio:['pipe','pipe','ignore']});
  const pending=new Map();let seq=0;
  createInterface({input:p.stdout}).on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}const q=pending.get(m.id);if(q){clearTimeout(q.timer);pending.delete(m.id);m.error?q.reject(new Error(JSON.stringify(m.error))):q.resolve(m.result);}});
  const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>reject(new Error(`${method} timed out`)),30000);pending.set(id,{resolve,reject,timer});p.stdin.write(JSON.stringify({id,method,params})+'\n');});
  try{
    await rpc('initialize',{clientInfo:{name:'zhongxing-local-install',version:'1.0.0'},capabilities:{experimentalApi:true}});
    p.stdin.write(JSON.stringify({method:'initialized'})+'\n');
    await rpc('config/batchWrite',{edits:[{keyPath:`plugins.\"${localId}\".enabled`,value:local,mergeStrategy:'upsert'},{keyPath:`plugins.\"${publicId}\".enabled`,value:publicEnabled,mergeStrategy:'upsert'}]});
  }finally{p.stdin.end();p.kill();for(const q of pending.values())clearTimeout(q.timer);}
}
if(process.argv.includes('--rollback')){
  const state=JSON.parse(await readFile(stateFile,'utf8'));await flags(false,state.publicEnabled);
  console.log(JSON.stringify({rolledBack:true,dataPreserved:true,enabled:publicId}));
}else{
  const backup=join(root,'verification/local-2.1/backup-'+new Date().toISOString().replace(/[:.]/g,'-'));
  await mkdir(backup,{recursive:true,mode:0o700});
  const configFile=join(codeHome,'config.toml'), config=await readFile(configFile,'utf8');
  await cp(configFile,join(backup,'config.toml'));
  const section=config.split(`[plugins.\"${publicId}\"]`)[1]?.split('\n[')[0]||'';
  let previous;try{previous=JSON.parse(await readFile(stateFile,'utf8'));}catch{}
  const publicEnabled=previous?.publicEnabled??/enabled\s*=\s*true/.test(section);
  const data=getUserDataRoot();try{await access(data);await cp(data,join(backup,'user-data'),{recursive:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  const stage=join(root,'release/local-marketplace');await cp(join(root,'release/zhongxing-canvas'),stage,{recursive:true});
  const file=join(stage,'.agents/plugins/marketplace.json'),market=JSON.parse(await readFile(file,'utf8'));market.name='zhongxing-canvas-local';await writeFile(file,JSON.stringify(market,null,2));
  const added=command(['plugin','marketplace','add',resolve(stage),'--json']);
  const pkg=JSON.parse(await readFile(join(stage,'package.json'),'utf8'));
  const cached=join(codeHome,'plugins/cache/zhongxing-canvas-local/zhongxing-canvas',pkg.version,'mcp/generated/server.mjs');
  let stale=false;try{for(const file of ['server.mjs','asset-manifest.json']){const old=await readFile(join(cached,'..',file)),next=await readFile(join(stage,'mcp/generated',file));if(!createHash('sha256').update(old).digest().equals(createHash('sha256').update(next).digest()))stale=true;}}catch{}
  if(stale)command(['plugin','remove',localId,'--json']);
  const installed=command(['plugin','add',localId,'--json']);
  await flags(true,false);
  await mkdir(join(root,'verification/local-2.1'),{recursive:true});
  await writeFile(stateFile,JSON.stringify({backup:previous?.backup||backup,lastBackup:backup,publicEnabled,installed,added,dataDirectory:data},null,2),{mode:0o600});
  console.log(JSON.stringify({installed,backup,dataPreserved:true,publicVersionRetained:true},null,2));
}
