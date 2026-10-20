import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';

export function groupImageAnnotations(elements:readonly ExcalidrawElement[],imageId:string) {
  const image=elements.find(e=>e.id===imageId&&e.type==='image'&&!e.isDeleted);
  const notes=elements.filter(e=>!e.isDeleted&&e.customData?.zhongxingAnnotationTargetId===imageId);
  if(!image||!notes.length)return elements;
  const saved=image.customData?.zhongxingAnnotationGroupId;
  const groupId=typeof saved==='string'?saved:crypto.randomUUID();
  const outer=image.groupIds.filter(id=>id!==groupId);
  return elements.map(e=>{
    if(e.isDeleted||(e.id!==imageId&&e.customData?.zhongxingAnnotationTargetId!==imageId))return e;
    const inner=e.id===imageId?[]:e.groupIds.filter(id=>id!==groupId&&!outer.includes(id));
    const groupIds=[...inner,groupId,...outer];
    const customData=e.id===imageId?{...e.customData,zhongxingAnnotationGroupId:groupId}:e.customData;
    if(JSON.stringify(e.groupIds)===JSON.stringify(groupIds)&&(e.id!==imageId||saved===groupId))return e;
    return {...e,groupIds,customData,version:e.version+1,versionNonce:Math.floor(Math.random()*2**31),updated:Date.now()} as ExcalidrawElement;
  });
}
export function groupExistingAnnotations(elements:readonly ExcalidrawElement[]) {
  let grouped=elements;
  for(const image of elements)if(image.type==='image'&&!image.isDeleted)grouped=groupImageAnnotations(grouped,image.id);
  return grouped;
}
export function selectedAnnotationImage(elements:readonly ExcalidrawElement[],selection:Readonly<Record<string,boolean>>) {
  const selected=elements.filter(e=>!e.isDeleted&&selection[e.id]);
  const images=selected.filter(e=>e.type==='image');
  if(images.length!==1)return undefined;
  const image=images[0];
  return selected.every(e=>e.id===image.id||e.customData?.zhongxingAnnotationTargetId===image.id)?image:undefined;
}
