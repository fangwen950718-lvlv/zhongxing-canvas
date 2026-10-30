import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyProject, parseProject } from '../src/project';

test('reference cards round trip with legacy compatibility and reject unsafe URLs', () => {
  const project=emptyProject();
  project.aiOptions=[{title:'方向',proposal:'概念',imagePrompt:'提示',references:[{title:'参考',source:'来源',pageUrl:'https://example.com/work',preview:'data:image/png;base64,iVBORw0KGgo='}],referenceMessage:''}];
  project.aiReferenceJobId='11111111-1111-4111-8111-111111111111';
  const parsed=parseProject(JSON.parse(JSON.stringify(project)));
  assert.equal(parsed.aiOptions?.[0].references?.[0].pageUrl,'https://example.com/work');
  assert.equal(parsed.aiReferenceJobId,project.aiReferenceJobId);
  assert.doesNotThrow(()=>parseProject(JSON.parse(JSON.stringify(emptyProject()))));
  project.aiOptions[0].references![0].pageUrl='javascript:alert(1)';
  assert.throws(()=>parseProject(JSON.parse(JSON.stringify(project))));
});

test('reference groups are independent of completed brief and reset preserves options', async () => {
  const dir=await mkdtemp(join(tmpdir(),'zx-refs-'));
  process.env.ZHONGXING_CANVAS_DATA_DIR=dir;
  try {
    const store=await import('../mcp/runtime/job-store.mjs');
    const job=await store.createBriefJob({brief:'测试',ruleText:'规则'});
    const options=[1,2,3].map(n=>({title:`方向${n}`,proposal:'概念',imagePrompt:'提示'}));
    await store.completeBriefJob(job.id,options);
    await store.setBriefReferences(job.id,1,[{title:'参考',source:'来源',pageUrl:'https://example.com'}],'');
    const read=await store.readBriefJob(job.id);
    assert.equal(read.status,'completed');
    assert.equal(read.referenceGroups[0],null);
    assert.equal(read.referenceGroups[1].references[0].title,'参考');
    assert.deepEqual(read.options.map((v: {title:string})=>v.title),options.map(v=>v.title));
    const reset=await store.resetBriefReferences(job.id);
    assert.equal(reset.referenceGroups.length,0);
    assert.equal(reset.options.length,3);
    await assert.rejects(store.setBriefReferences(job.id,9,[],''));
  } finally { await rm(dir,{recursive:true,force:true}); }
});
