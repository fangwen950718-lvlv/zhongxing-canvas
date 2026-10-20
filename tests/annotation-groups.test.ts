import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupExistingAnnotations, groupImageAnnotations, selectedAnnotationImage } from '../src/annotationGroups';
import { parseProject, emptyProject } from '../src/project';
const element=(id:string,type:string,extra:any={})=>({id,type,x:20,y:30,width:80,height:50,angle:0,seed:1,version:1,versionNonce:1,updated:1,isDeleted:false,groupIds:[],customData:{},text:'修改',fontSize:18,fileId:'file',...extra}) as any;

test('annotations share a group with their image, preserving pair and outer groups',()=>{
  const source=element('image','image',{groupIds:['outer'],customData:{keep:'yes'}});
  const arrow=element('arrow','arrow',{groupIds:['pair'],customData:{zhongxingAnnotationTargetId:'image'}});
  const text=element('text','text',{groupIds:['pair'],customData:{zhongxingAnnotationTargetId:'image',zhongxingAnnotationNote:'修改颜色'}});
  const unrelated=element('other','rectangle');const input=[source,arrow,text,unrelated];
  const grouped=groupImageAnnotations(input,'image');const group=grouped[0].customData!.zhongxingAnnotationGroupId as string;
  assert.deepEqual(grouped[0].groupIds,[group,'outer']);assert.deepEqual(grouped[1].groupIds,['pair',group,'outer']);
  assert.deepEqual(grouped[2].groupIds,['pair',group,'outer']);assert.equal(grouped[0].customData!.keep,'yes');
  assert.equal(grouped[3],unrelated);assert.deepEqual(source.groupIds,['outer']);
  assert.deepEqual(grouped.map(e=>[e.x,e.y]),input.map(e=>[e.x,e.y]));
  const again=groupImageAnnotations(grouped,'image');assert.ok(again.every((e,i)=>e===grouped[i]));
  const next=groupImageAnnotations([...grouped,element('second','arrow',{customData:{zhongxingAnnotationTargetId:'image'}})],'image');
  assert.deepEqual(next[4].groupIds,[group,'outer']);
});
test('whole-group selection exposes image actions but mixed image selections do not',()=>{
  const image=element('img','image'),annotation=element('note','text',{customData:{zhongxingAnnotationTargetId:'img'}}),other=element('other','image');
  const scene=[image,annotation,other];
  assert.equal(selectedAnnotationImage(scene,{img:true,note:true}),image);
  assert.equal(selectedAnnotationImage(scene,{img:true}),image);
  assert.equal(selectedAnnotationImage(scene,{note:true}),undefined);
  assert.equal(selectedAnnotationImage(scene,{img:true,other:true}),undefined);
});
test('legacy annotations migrate without moving content and survive project round trip',()=>{
  const scene=[element('img','image'),element('note','text',{customData:{zhongxingAnnotationTargetId:'img'}})];
  const grouped=groupExistingAnnotations(scene);assert.equal(grouped[0].groupIds[0],grouped[1].groupIds[0]);
  const p=emptyProject();p.scene.elements=grouped;
  p.scene.files={file:{id:'file',mimeType:'image/png',dataURL:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6L8AAAAASUVORK5CYII=',created:Date.now()}} as any;
  const parsed=parseProject(JSON.parse(JSON.stringify(p)));assert.deepEqual(parsed.scene.elements.map(e=>e.groupIds),grouped.map(e=>e.groupIds));
});
