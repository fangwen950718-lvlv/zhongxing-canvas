import {useState,useRef} from 'react';
import {promptPresets,composePreset} from './promptPresets';
import type {PresetSettings} from './generationParams';
import real from '../assets/preset-examples/real.png';
import meme from '../assets/preset-examples/meme.png';
import threeD from '../assets/preset-examples/three-d.png';
import product from '../assets/preset-examples/product.png';
import title from '../assets/preset-examples/title.png';
const examples:Record<string,string>={real,meme,'three-d':threeD,product,title};
export default function PresetLibrary({base,disabled,onApply,initial=null}:{base:string;disabled:boolean;initial?:PresetSettings|null;onApply:(prompt:string,preset:PresetSettings|null)=>void}){
  const [id,setId]=useState(initial?.id||''),[values,setValues]=useState<Record<string,string>>(initial?.values||{}),[skeleton,setSkeleton]=useState(initial?.skeleton||''),[negative,setNegative]=useState(initial?.negative||''),[anti,setAnti]=useState(initial?.anti??false);
  const preset=promptPresets.find(p=>p.id===id);
  const baseRef=useRef(initial?.base??base);
  function choose(value:string){if(!id)baseRef.current=base;const p=promptPresets.find(p=>p.id===value);setId(value);if(!p){onApply(baseRef.current,null);return;}setValues({...p.variables});setSkeleton(p.skeleton);setNegative(p.negative);setAnti(p.id==='real');onApply(composePreset(p,p.skeleton,p.negative,p.variables,baseRef.current,p.id==='real'),{id:p.id,name:p.name,values:{...p.variables},skeleton:p.skeleton,negative:p.negative,anti:p.id==='real',base:baseRef.current});}
  function apply(nextValues=values,nextSkeleton=skeleton,nextNegative=negative,nextAnti=anti){if(preset)onApply(composePreset(preset,nextSkeleton,nextNegative,nextValues,baseRef.current,nextAnti),{id:preset.id,name:preset.name,values:nextValues,skeleton:nextSkeleton,negative:nextNegative,anti:nextAnti,base:baseRef.current});}
  return <section className="preset-library"><label className="field">提示词预设库<select aria-label="提示词预设" disabled={disabled} value={id} onChange={e=>choose(e.target.value)}><option value="">不使用预设</option>{promptPresets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {preset&&<><div className="preset-intro"><img src={examples[preset.example]} alt={`${preset.name} · AI示例成图`}/><div><strong>{preset.name}</strong><p>{preset.scenario}</p><small>适用：{preset.applicable}</small><small>AI示例，仅演示质感，不作为当前参考图。</small></div></div>
      <div className="preset-vars">{Object.entries(values).map(([key,value])=><label key={key}>{key}<input aria-label={key} placeholder="可选，可留空" disabled={disabled} value={value} onChange={e=>{const next={...values,[key]:e.target.value};setValues(next);apply(next);}}/></label>)}</div>
      <details><summary>编辑骨架、负向词与参考建议</summary><label className="field">提示词骨架<textarea disabled={disabled} rows={4} value={skeleton} onChange={e=>{setSkeleton(e.target.value);apply(values,e.target.value);}}/></label><label className="field">负向词<textarea disabled={disabled} rows={2} value={negative} onChange={e=>{setNegative(e.target.value);apply(values,skeleton,e.target.value);}}/></label><p>{preset.referenceAndParameters}</p></details>
      {['real','meme','three-d'].includes(id)&&<label className="preset-check"><input type="checkbox" disabled={disabled} checked={anti} onChange={e=>{setAnti(e.target.checked);apply(values,skeleton,negative,e.target.checked);}}/>反塑料感（按主体材质适用）</label>}
      <small>更改预设或变量会重新填充下方提示词；自由编辑后请勿再切换，以免覆盖编辑。</small>
    </>}
  </section>;
}
