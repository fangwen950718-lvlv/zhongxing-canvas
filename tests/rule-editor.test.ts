import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyProject,parseProject} from '../src/project';
import {availableRules,applyRules,presetIds,commonRules,effectiveRules} from '../src/ruleLibraryState';
const defaults=presetIds.map(id=>({id,name:id,content:'原规则',createdAt:'2026-01-01T00:00:00Z'}));
test('rule edits and deletions survive export/import without resurrecting defaults',()=>{
  const project=emptyProject();
  const edited={...defaults[0],name:'新的名称',content:'修改后的完整规则'};
  const uploaded={...edited,id:'uploaded-test',name:'新增规则'};
  const saved=applyRules(project,[edited,...defaults.slice(2),uploaded],defaults);
  const restored=parseProject(JSON.parse(JSON.stringify(saved)));
  const rules=availableRules(restored,defaults);
  assert.equal(rules.length,5);assert.equal(rules[0].content,edited.content);
  assert(!rules.some(rule=>rule.id===defaults[1].id));
  assert.equal(rules.at(-1)?.name,'新增规则');
  assert.equal(availableRules(project,defaults)[0].content,'原规则');
});
test('deleting selected or all rules has a valid fallback and stays deleted',()=>{
  const project=emptyProject();
  assert.equal(applyRules(project,defaults.slice(1),defaults).ruleLibraryId,defaults[1].id);
  const empty=applyRules(project,[],defaults);
  assert.equal(empty.ruleLibraryId,'');
  assert.deepEqual(availableRules(parseProject(JSON.parse(JSON.stringify(empty))),defaults),[]);
});
test('legacy uploads stay selectable and corrupt deletion records are rejected',()=>{
  const project=emptyProject();project.customRuleLibraries=[{...defaults[0],id:'uploaded-old'}];project.ruleLibraryId='uploaded-old';
  const restored=parseProject(JSON.parse(JSON.stringify(project)));
  assert.equal(restored.ruleLibraryId,'uploaded-old');assert.equal(availableRules(restored,defaults).length,6);
  assert.throws(()=>parseProject({...project,deletedRuleLibraryIds:['unknown']}));
});
test('complete editable rules preserve defaults for old projects and exact user replacements',()=>{
  const project=emptyProject();
  assert.match(commonRules(project),/工作顺序/);assert.match(commonRules(project),/层级规则/);
  project.commonRulesText='工作顺序：先研究主体。\n层级规则：只输出简短方向。\n画面规则：允许多个视觉主体。';
  const restored=parseProject(JSON.parse(JSON.stringify(project)));
  const full=effectiveRules(restored,{label:'测试分类',rules:'自定义分类规则'});
  assert(full.includes(project.commonRulesText));assert(full.includes('自定义分类规则'));assert(!full.includes('单母体收敛'));
  restored.commonRulesText='';
  const empty=parseProject(JSON.parse(JSON.stringify(restored)));
  assert.equal(commonRules(empty),'');assert(!effectiveRules(empty,{label:'测试',rules:'分类内容'}).includes('工作顺序'));
  assert.throws(()=>parseProject({...project,commonRulesText:123}));
});
