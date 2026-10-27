import { useState } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { createImageActionJob, downloadOriginalImage, sendCodexMessage } from './codexBridge';
import { actionPrompt, commandForImageJob, originalFile } from './imageActionUtils';
import type { ImageJob } from './ImageGenerator';

export default function ImageActions({ api, image, position, projectName, onAnnotate, onParameters, onDownload, onCreated, onStatus, onRetryNeeded }: {
  api: ExcalidrawImperativeAPI; image: ExcalidrawElement; position:{left:number;top:number}; projectName:string;
  onAnnotate:()=>void; onDownload:(blob:Blob,name:string,savedPath?:string)=>void; onCreated:(job:ImageJob,source:ExcalidrawElement)=>void; onStatus:(message:string)=>void;
  onRetryNeeded:(id:string)=>void;
  onParameters:()=>void;
}) {
  const [size,setSize]=useState<{width:string;height:string}|null>(null);
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const [hd,setHd]=useState<{width:number;height:number;factor:2|4}|null>(null);
  const [hdMode,setHdMode]=useState<'texture-preserve'|'whole-resample'>('texture-preserve');
  const hdError=hd&&(Math.max(hd.width,hd.height)*hd.factor>8192||hd.width*hd.height*hd.factor*hd.factor>32_000_000)?'目标超过最大边 8192px 或 3200 万像素，请降低倍率。':'';
  async function source() {
    if(image.type!=='image'||!image.fileId) throw new Error('请选中一张图片');
    const file=api.getFiles()[image.fileId];
    if(!file) throw new Error('原图文件缺失，请重新导入');
    const decoded=new Image();decoded.src=file.dataURL;await decoded.decode();
    return { file, width:decoded.naturalWidth, height:decoded.naturalHeight, decoded };
  }
  async function download() {
    setBusy(true);
    try { const {file,decoded}=await source(); decoded.src=''; const output=originalFile(file.dataURL, `${projectName}-原图-${image.id.slice(0,8)}`); const savedPath=await downloadOriginalImage(file.dataURL,output.name); onDownload(output.blob,output.name,savedPath||undefined); }
    catch(e){onStatus(`原图下载失败：${e instanceof Error?e.message:e}`);}
    finally{setBusy(false);}
  }
  async function openSize() {
    try {const s=await source();s.decoded.src='';setSize({width:String(s.width),height:String(s.height)});setError('');}
    catch(e){onStatus(String(e));}
  }
  async function openHd() {try{const s=await source();s.decoded.src='';setHd({width:s.width,height:s.height,factor:2});setError('');}catch(e){onStatus(String(e));}}
  async function submit(kind:'relayout'|'remove-background'|'upscale') {
    setBusy(true);setError('');
    try {
      const s=await source();
      const width=kind==='relayout'?Number(size?.width):kind==='upscale'?s.width*(hd?.factor||2):s.width, height=kind==='relayout'?Number(size?.height):kind==='upscale'?s.height*(hd?.factor||2):s.height;
      if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=8192)||width*height>32_000_000) throw new Error('请输入 1–8192 的整数像素，总像素不超过 3200 万。');
      let originalDataURL:string=s.file.dataURL;
      if(kind==='upscale'||!/^data:image\/(png|jpeg|webp);base64,/.test(originalDataURL)) {
        const canvas=document.createElement('canvas');canvas.width=s.width;canvas.height=s.height;
        const ctx=canvas.getContext('2d');if(!ctx)throw new Error('无法读取原图');ctx.drawImage(s.decoded,0,0);originalDataURL=canvas.toDataURL('image/png');
      }
      s.decoded.src='';
      const job=await createImageActionJob({kind,...(kind==='upscale'?{upscaleMode:hdMode}:{}),sourceImageId:image.id,sourceWidth:s.width,sourceHeight:s.height,width,height,originalDataURL,prompt:kind==='upscale'?hdMode==='texture-preserve'?`本地非生成式保真放大到 ${width}×${height}，不AI重绘，不调用线稿，不切块，不锐化。`:`整图 AI 修复：保持完整原图 ${s.width}:${s.height} 的比例和边界，锁定主体身份、数量、位置、逐字文案、颜色及光照。仅原图作为像素编辑目标，三稿只说明结构，不重建三稿纹理。不要补描或复制蚯蚓纹、噪点和融化瑕疵。无额外噪点与锐化。输出原生尽可能清晰的完整 PNG，不切块、不拼接。插件再统一尺寸，不是原生超分。`:actionPrompt(kind,width,height)});
      onCreated(job,image);setSize(null);setHd(null);
      if(job.status==='completed'){onStatus(job.message||'本地放大已完成，正在回填原图旁，不消耗生图额度。');return;}
      onStatus('任务已创建，正在发送到 Codex…');
      const sent=await sendCodexMessage(commandForImageJob(job));
      if(!sent)onRetryNeeded(job.id);
      onStatus(sent?'图片任务已发送，进度将在当前对话和画布中显示，结果放在原图旁。':'任务已保留，但发送未成功。请点击“重新发送”重试。');
    }catch(e){const message=e instanceof Error?e.message:String(e);setError(message);onStatus(`图片操作未完成：${message}`);}
    finally{setBusy(false);}
  }
  return <>
    <div className="selection-action" role="toolbar" aria-label="选中图片操作" style={position} onPointerDown={e=>e.stopPropagation()}>
      <button disabled={busy} onClick={onAnnotate}>修改标注</button>
      <button disabled={busy} onClick={()=>void download()}>下载原图</button>
      <button disabled={busy} onClick={()=>void openSize()}>延展尺寸</button>
      <button disabled={busy} onClick={()=>void submit('remove-background')}>{busy?'正在提交…':'去除背景'}</button>
      <button disabled={busy} onClick={()=>void openHd()}>智能高清</button>
      <button disabled={busy} onClick={onParameters}>生图参数</button>
    </div>
    {hd&&<div className="modal-shade" onPointerDown={e=>e.stopPropagation()}><section className="modal generation-modal" role="dialog" aria-modal="true" aria-label="智能高清">
      <h2>智能高清</h2><label className="field">处理方式<select aria-label="高清处理方式" disabled={busy} value={hdMode} onChange={e=>setHdMode(e.target.value as typeof hdMode)}><option value="texture-preserve">保留纹理 · 本地放大（推荐对照）</option><option value="whole-resample">AI 整图修复 · 可能改动细节</option></select></label><p>{hdMode==='texture-preserve'?'不重画人脸、发丝或文字。轻度清理平涂小噪点，再用无振铃的双线性插值放大；不会创造新细节，原有强噪纹仍可能保留。':'整图AI修复再统一放大，不切块；线稿只作结构提示。模型没有可调去噪强度接口，仍可能重画或新增瑕疵。'}</p>
      <div className="ratio-grid">{([2,4] as const).map(factor=><button key={factor} disabled={busy} aria-pressed={hd.factor===factor} onClick={()=>setHd({...hd,factor})}>×{factor}<small>{hd.width*factor} × {hd.height*factor} px</small></button>)}</div>
      <p>{hdError||(hdMode==='texture-preserve'?'不调用模型，不消耗生图额度。':'预计1次生图，失败最多额外重试1次。')} 并非原生 ×2/×4 超分，100%视图请核对文字与纹理。最大边8192px、3200万像素，原图保留。</p>
      {error&&<p role="alert">{error}</p>}<div className="modal-actions"><button disabled={busy} onClick={()=>setHd(null)}>取消</button><button disabled={busy||!!hdError} className="primary compact" onClick={()=>void submit('upscale')}>{busy?'正在发送…':'确认高清'}</button></div>
    </section></div>}
    {size&&<div className="modal-shade" onPointerDown={e=>e.stopPropagation()}><section className="modal generation-modal" role="dialog" aria-modal="true" aria-label="延展尺寸">
      <h2>延展尺寸</h2><p>按新画幅重新布局。AI 会尽量保留原有元素与文案，生成后请核对文字和细节。</p>
      <div className="ratio-grid">{['1:1','4:3','3:4','16:9','9:16','3:2','2:3'].map(r=><button disabled={busy} key={r} onClick={()=>{const [w,h]=r.split(':').map(Number);const scale=1536/Math.max(w,h);setSize({width:String(Math.round(w*scale)),height:String(Math.round(h*scale))});}}>{r}</button>)}</div>
      <div className="size-inputs"><label>宽度（px）<input aria-label="目标宽度" type="number" min="1" max="8192" value={size.width} disabled={busy} onChange={e=>setSize({...size,width:e.target.value})}/></label><span>×</span><label>高度（px）<input aria-label="目标高度" type="number" min="1" max="8192" value={size.height} disabled={busy} onChange={e=>setSize({...size,height:e.target.value})}/></label></div>
      {error&&<p role="alert">{error}</p>}<div className="modal-actions"><button disabled={busy} onClick={()=>setSize(null)}>取消</button><button disabled={busy} className="primary compact" onClick={()=>void submit('relayout')}>{busy?'正在发送…':'确认延展'}</button></div>
    </section></div>}
  </>;
}
