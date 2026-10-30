import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,chmod,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkUpdate,compareVersions,installUpdate } from '../mcp/runtime/updates.mjs';

test('version check handles newer, stable and unavailable versions',async()=>{
  assert.equal(compareVersions('2.4.0','2.3.9'),1);
  assert.equal(compareVersions('2.3.0','2.3.0-local.4'),1);
  assert.equal(compareVersions('2.3.0','2.3.0'),0);
  const fetcher=async()=>new Response(JSON.stringify({name:'zhongxing-canvas',version:'2.4.0'}));
  assert.equal((await checkUpdate('2.3.0',fetcher)).available,true);
  await assert.rejects(checkUpdate('2.3.0',async()=>new Response('no',{status:503})));
  await assert.rejects(checkUpdate('2.3.0',async()=>new Response(JSON.stringify({name:'wrong',version:'2.4.0'}))));
});

test('failed refresh never removes or installs current plugin',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'zx-update-'));const original=process.env.PATH,originalFetch=globalThis.fetch;
  try {
    const script=join(dir,'codex'),log=join(dir,'calls');
    await writeFile(script,`#!/bin/sh\nprintf '%s\n' "$*" >> '${log}'\nexit 1\n`);await chmod(script,0o755);
    process.env.PATH=dir;
    globalThis.fetch=async()=>new Response(JSON.stringify({name:'zhongxing-canvas',version:'2.4.0'}));
    await assert.rejects(installUpdate('2.3.0'),/更新未确认完成/);
    const calls=await readFile(log,'utf8');
    assert.match(calls,/plugin marketplace upgrade/);
    assert.doesNotMatch(calls,/plugin remove|plugin add/);
  } finally {process.env.PATH=original;globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true});}
});
