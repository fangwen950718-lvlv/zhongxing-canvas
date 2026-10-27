import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promptPresets,composePreset} from '../src/promptPresets';
import {generationSnapshot,readGenerationParams,generationSizes,type GenerationDraft} from '../src/generationParams';
import {emptyProject,parseProject} from '../src/project';
import {ratios} from '../mcp/runtime/job-store.mjs';

const p=promptPresets.find(p=>p.id==='real')!;
for(const [name,values] of Object.entries({empty:{人物特征:'',发型:'',着装:'',气质:''},partial:{人物特征:'年轻女性',发型:'',着装:'',气质:''},full:p.variables})){
  test(`portrait variables ${name} produce valid prompt without resurrecting cleared defaults`,()=>{
    const prompt=composePreset(p,p.skeleton,p.negative,values,'测试海报',true);
    assert(prompt.trim());assert(!/\{[^{}]+\}/.test(prompt));assert(!/发型：，|着装：。|气质：。/.test(prompt));
    if(name!=='full'){assert(!prompt.includes('约45岁'));assert(!prompt.includes('浅灰色圆领上衣'));assert(!prompt.includes('短侧分黑发'));}
    const draft:GenerationDraft={prompt,ratio:'3:4',preset:{id:p.id,name:p.name,values,skeleton:p.skeleton,negative:p.negative,anti:true,base:'测试海报'},ruleText:'可编辑的规则',ruleLabel:'人物海报',referenceImages:[]};
    assert.deepEqual(readGenerationParams(JSON.parse(JSON.stringify(generationSnapshot(draft))))?.preset?.values,values);
  });
}
test('snapshot survives project export/import and keeps manual prompt and preset settings independently',()=>{
  const draft:GenerationDraft={prompt:'我手动改过的最终提示词 {JSON不是预设变量}',ratio:'16:9',preset:{id:p.id,name:p.name,values:{人物特征:'',发型:'',着装:'蓝衬衫',气质:''},skeleton:'自定义{着装}',negative:'定制负向词',anti:false,base:'原始需求'},ruleText:'当时完整规则快照',ruleLabel:'人物海报',referenceImages:[{id:'reference-test',name:'参考.png',dataURL:'data:image/png;base64,AAAA'}]};
  const params=generationSnapshot(draft);draft.preset!.values.着装='之后才改的红衬衫';assert.equal(params.preset!.values.着装,'蓝衬衫');
  const project=emptyProject();project.scene.files['fixture']={id:'fixture',created:1,mimeType:'image/png',dataURL:'data:image/png;base64,AAAA'};
  project.scene.elements=[{id:'new-image',type:'image',fileId:'fixture',x:1,y:1,width:1024,height:1024,angle:0,version:1,seed:1,isDeleted:false,groupIds:[],customData:{zhongxingGenerationParams:params}} as never];
  const imported=parseProject(JSON.parse(JSON.stringify(project)));
  const restored=readGenerationParams(imported.scene.elements[0].customData?.zhongxingGenerationParams)!;
  assert.deepEqual(restored,params);assert.equal(restored.prompt,'我手动改过的最终提示词 {JSON不是预设变量}');
  assert.deepEqual(restored.references,[{id:'generation-ref-reference-test',name:'参考.png'}]);
  assert.equal(generationSnapshot({...draft,referenceImages:[{id:restored.references[0].id,name:'参考.png',dataURL:'data:image/png;base64,AAAA'}]}).references[0].id,restored.references[0].id);
});
test('legacy or malformed metadata is explicitly absent; never guess from a legacy prompt',()=>{
  for(const value of [undefined,null,{},'bad',{prompt:'old prompt'},{version:1,mode:'generate',prompt:'x',ratio:'invalid'}])assert.equal(readGenerationParams(value),null);
});
test('pending frame size defaults agree with server ratio contract',()=>assert.deepEqual(generationSizes,ratios));
