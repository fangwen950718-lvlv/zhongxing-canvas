import type {ReferenceImageInput} from './ReferenceImagePicker';
export interface PresetSettings {
  id:string; name:string; values:Record<string,string>; skeleton:string;
  negative:string; anti:boolean; base:string;
}
/** Project-owned snapshot; file references share scene.files instead of duplicating large data URLs. */
export interface GenerationParams {
  version:1; mode:'generate'; prompt:string; ratio:string;
  width:number; height:number; preset:PresetSettings|null;
  ruleText:string; ruleLabel:string;
  references:Array<{id:string;name:string}>;
}
export interface GenerationDraft {
  prompt:string; ratio:string; preset:PresetSettings|null;
  ruleText:string; ruleLabel:string; referenceImages:ReferenceImageInput[];
}
export const generationSizes:Record<string,[number,number]>={
  '1:1':[1024,1024],'4:3':[1365,1024],'3:4':[1024,1365],
  '16:9':[1536,864],'9:16':[864,1536],'3:2':[1536,1024],'2:3':[1024,1536],
};
export function generationSnapshot(draft:GenerationDraft):GenerationParams {
  const [width,height]=generationSizes[draft.ratio]||generationSizes['1:1'];
  return {version:1,mode:'generate',prompt:draft.prompt,ratio:draft.ratio,width,height,
    preset:draft.preset?structuredClone(draft.preset):null,ruleText:draft.ruleText,ruleLabel:draft.ruleLabel,
    references:draft.referenceImages.map(({id,name})=>({id:id.startsWith('generation-ref-')?id:`generation-ref-${id}`,name}))};
}
export function readGenerationParams(value:unknown):GenerationParams|null {
  if(!value||typeof value!=='object')return null;
  const p=value as GenerationParams;
  if(p.version!==1||p.mode!=='generate'||typeof p.prompt!=='string'||!p.prompt.trim()||p.prompt.length>12000||!Object.hasOwn(generationSizes,p.ratio))return null;
  if(!Number.isSafeInteger(p.width)||!Number.isSafeInteger(p.height)||p.width<1||p.height<1||typeof p.ruleText!=='string'||p.ruleText.length>120000||typeof p.ruleLabel!=='string')return null;
  if(!Array.isArray(p.references)||!p.references.every(r=>r&&typeof r.id==='string'&&typeof r.name==='string'))return null;
  const s=p.preset;
  if(s!==null&&(!s||typeof s.id!=='string'||typeof s.name!=='string'||typeof s.skeleton!=='string'||typeof s.negative!=='string'||typeof s.base!=='string'||typeof s.anti!=='boolean'||!s.values||Object.values(s.values).some(v=>typeof v!=='string')))return null;
  return p;
}
