import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {availableRules,effectiveRules} from '../src/ruleLibraryState';
import legacy from '../src/legacyRuleDefaults.json';

const names=['社媒海报','人物海报','三维IP海报','产品主K','资源位物料'];
const labels=['社媒海报','人物海报','三维 IP 海报','产品主 K','资源位物料'];
const ids=Object.keys(legacy);
process.env.ZHONGXING_TEST_RUNTIME=await mkdtemp(join(tmpdir(),'zhongxing-v2-rules-'));
const {createBriefJob,readBriefJob}=await import('../scripts/brief-jobs.mjs');
test('five V2 libraries replace stock snapshots, preserving edited, renamed, uploaded and deleted libraries',async()=>{
  const imports=await readFile(new URL('../src/creativeRules.ts',import.meta.url),'utf8');
  for(let i=0;i<ids.length;i++){
    const id=ids[i],file=`0${i+1}_${names[i]}_审美判断_V2.md`;
    const content=await readFile(new URL('../knowledge/aesthetic-rules/'+file,import.meta.url),'utf8');
    assert(imports.includes(file));assert(!imports.includes('_V1.md'));
    assert(content.includes('V2'));assert(content.includes('三组'));assert(content.includes('imagePrompt'));
    const current={id,name:labels[i],content,createdAt:'2026-10-26T00:00:00.000Z'};
    const old={...current,content:legacy[id as keyof typeof legacy]};
    assert.equal(availableRules({customRuleLibraries:[old]},[current])[0].content,content);
    for(const saved of [{...old,content:old.content+'\n我的补充'},{...old,name:'我的规则'}])
      assert.deepEqual(availableRules({customRuleLibraries:[saved]},[current])[0],saved);
    assert.deepEqual(availableRules({deletedRuleLibraryIds:[id]},[current]),[]);
    const uploaded={...old,id:'uploaded-my-rules',name:'自建规则'};
    assert.deepEqual(availableRules({customRuleLibraries:[uploaded]},[current])[1],uploaded);
    const preview=effectiveRules({commonRulesText:'我自定义的通用规则'},{label:labels[i],rules:content});
    assert(preview.endsWith(content));assert(preview.startsWith('# 众行通用底层规则\n我自定义的通用规则'));
    const job=await createBriefJob({brief:'仅校验规则传递，不生成图片',ruleLabel:labels[i],ruleText:preview});
    assert.equal((await readBriefJob(job.id)).ruleText,preview.trim());
  }
});
