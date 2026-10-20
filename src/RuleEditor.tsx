import React, { useRef, useState } from 'react';
import type { CustomRuleLibrary } from './project';

export default function RuleEditor({libraries,commonText,onSave,onClose}:{libraries:CustomRuleLibrary[];commonText:string;onSave:(rules:CustomRuleLibrary[],common:string)=>void;onClose:()=>void}) {
  const [common,setCommon]=useState(commonText);
  const [draft,setDraft]=useState(libraries.map(rule=>({...rule})));
  const [selected,setSelected]=useState(libraries[0]?.id || '');
  const [error,setError]=useState('');
  const [deleting,setDeleting]=useState(false);
  const input=useRef<HTMLInputElement>(null);
  const current=draft.find(rule=>rule.id===selected);
  function change(patch:Partial<CustomRuleLibrary>) {setDraft(draft.map(rule=>rule.id===selected?{...rule,...patch}:rule));setError('');}
  async function upload(file?:File) {
    if(!file)return;
    try {
      if(!/\.(md|txt|json)$/i.test(file.name))throw new Error('请选择 Markdown、TXT 或 JSON 文本文件。');
      if(file.size>120*1024)throw new Error('规则文件请小于 120 KB。');
      if(draft.length>=30)throw new Error('最多保存 30 份规则，请先整理已有规则。');
      const content=await file.text();
      if(!content.trim()||content.length>120000)throw new Error('规则内容不能为空且不能超过 120000 字。');
      const rule={id:`uploaded-${crypto.randomUUID()}`,name:file.name.replace(/\.(md|txt|json)$/i,'' ).slice(0,200),content,createdAt:new Date().toISOString()};
      setDraft(previous=>[...previous,rule]);setSelected(rule.id);setDeleting(false);setError('');
    }catch(e){setError(e instanceof Error?e.message:'上传失败，请重试。');}
    finally{if(input.current)input.current.value='';}
  }
  function save() {
    const invalid=draft.find(rule=>!rule.name.trim()||!rule.content.trim());
    if(invalid){setSelected(invalid.id);setError('请填写规则名称和内容，或删除不需要的规则。');return;}
    onSave(draft.map(rule=>({...rule,name:rule.name.trim()})),common);
  }
  return <div className="modal-shade rule-editor-shade" onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape')onClose();}} onPointerDown={event=>event.stopPropagation()}>
    <section className="modal rule-editor" role="dialog" aria-modal="true" aria-labelledby="rule-editor-title">
      <div className="rule-editor-heading"><h2 id="rule-editor-title">编辑审美规则</h2><button onClick={()=>input.current?.click()}>＋ 上传新规则</button></div>
      <input ref={input} hidden type="file" accept=".md,.txt,.json" onChange={event=>void upload(event.target.files?.[0])}/>
      <div className="rule-editor-body"><nav aria-label="规则列表"><button aria-pressed={selected==='common'} onClick={()=>{setSelected('common');setDeleting(false);setError('');}}>通用底层规则</button>{draft.map(rule=><button key={rule.id} aria-pressed={selected===rule.id} onClick={()=>{setSelected(rule.id);setDeleting(false);setError('');}}>{rule.name||'未命名规则'}</button>)}{!draft.length&&<p>暂无规则，上传一份开始使用。</p>}</nav>
        <div className="rule-editor-fields">{selected==='common'?<><h3>通用底层规则</h3><p className="rule-editor-hint">应用于所有分类，包含工作顺序、层级与画面规则。可直接修改或清空，保存后生效。</p><label>规则内容<textarea autoFocus maxLength={120000} value={common} onChange={event=>setCommon(event.target.value)}/></label></>:current?<><label>规则名称<input autoFocus maxLength={200} value={current.name} onChange={event=>change({name:event.target.value})}/></label><label>规则内容<textarea maxLength={120000} value={current.content} onChange={event=>change({content:event.target.value})}/></label>
          <div className="rule-delete">{deleting?<><span>确定删除这份规则？保存后生效。</span><button onClick={()=>{const next=draft.filter(rule=>rule.id!==selected);setDraft(next);setSelected(next[0]?.id||'');setDeleting(false);}}>确认删除</button><button onClick={()=>setDeleting(false)}>保留</button></>:<button onClick={()=>setDeleting(true)}>删除规则</button>}</div></>:<p>上传规则后可在这里编辑。</p>}</div></div>
      {error&&<p className="rule-error" role="alert">{error}</p>}
      <div className="modal-actions"><button onClick={onClose}>取消</button><button className="primary compact" onClick={save}>保存</button></div>
    </section>
  </div>;
}
