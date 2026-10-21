import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSaveSchedule} from '../src/saveSchedule';
import {availableRules,effectiveRules} from '../src/ruleLibraryState';
import {legacyPortraitRules} from '../src/legacyPortraitRules';
test('continuous pan/edit coalesces full saves, but quiet input saves promptly',()=>{
  const schedule=createSaveSchedule();let writes=0;
  for(let now=0;now<=20000;now+=100){schedule.changed(now);if(schedule.ready(now)){writes++;schedule.success(true,now);}}
  assert.equal(writes,4);assert(!schedule.ready(21000));assert(schedule.ready(21200));
  schedule.success(false,21200);assert(!schedule.ready(99999));
});
test('background save failures back off without discarding unsaved changes',()=>{
  const schedule=createSaveSchedule();schedule.changed(0);assert(schedule.ready(1200));schedule.failed(1200);
  assert(!schedule.ready(6199));assert(schedule.ready(6200));schedule.failed(6200);
  assert(!schedule.ready(16199));assert(schedule.ready(16200));schedule.success(false,16200);assert(!schedule.ready(50000));
});
test('changes during a save remain dirty with a bounded next-save interval',()=>{
  const schedule=createSaveSchedule();schedule.changed(0);schedule.changed(4900);schedule.success(true,5000);schedule.changed(9000);
  assert(!schedule.ready(9500));assert(schedule.ready(10000));
});
test('only untouched legacy portrait stock text upgrades; user text, name and deletion survive',()=>{
  const current={id:'character-poster',name:'人物海报',content:'真实摄影与简洁棚拍的新规则',createdAt:'2026-01-01T00:00:00.000Z'};
  const old={...current,content:legacyPortraitRules};
  assert.equal(availableRules({customRuleLibraries:[old]},[current])[0].content,current.content);
  const changed={...old,content:old.content+'\n我的摄影规则'};
  assert.equal(availableRules({customRuleLibraries:[changed]},[current])[0].content,changed.content);
  assert.equal(availableRules({customRuleLibraries:[{...old,name:'我的人物规则'}]},[current])[0].content,old.content);
  assert.deepEqual(availableRules({deletedRuleLibraryIds:['character-poster']},[current]),[]);
  assert(effectiveRules({}, {label:current.name,rules:current.content}).includes(current.content));
});
