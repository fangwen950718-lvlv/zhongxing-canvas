import { useState } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { createImageActionJob, downloadOriginalImage, sendCodexMessage } from './codexBridge';
import { actionPrompt, commandForImageJob, originalFile } from './imageActionUtils';
import type { ImageJob } from './ImageGenerator';

export default function ImageActions({ api, image, position, projectName, onAnnotate, onDownload, onCreated, onStatus, onRetryNeeded }: {
  api: ExcalidrawImperativeAPI; image: ExcalidrawElement; position:{left:number;top:number}; projectName:string;
  onAnnotate:()=>void; onDownload:(blob:Blob,name:string,savedPath?:string)=>void; onCreated:(job:ImageJob,source:ExcalidrawElement)=>void; onStatus:(message:string)=>void;
  onRetryNeeded:(id:string)=>void;
}) {
  const [size,setSize]=useState<{width:string;height:string}|null>(null);
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const [hd,setHd]=useState<{width:number;height:number;factor:2|4}|null>(null);
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
    try { const {file}=await source(); const output=originalFile(file.dataURL, `${projectName}-原图-${image.id.slice(0,8)}`); const savedPath=await downloadOriginalImage(file.dataURL,output.name); onDownload(output.blob,output.name,savedPath||undefined); }
    catch(e){onStatus(`原图下载失败：${e instanceof Error?e.message:e}`);}
    finally{setBusy(false);}
  }
  async function openSize() {
    try {const s=await source();setSize({width:String(s.width),height:String(s.height)});setError('');}
    catch(e){onStatus(String(e));}
  }
  async function openHd() {try{const s=await source();setHd({width:s.width,height:s.height,factor:2});setError('');}catch(e){onStatus(String(e));}}
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
      const job=await createImageActionJob({kind,...(kind==='upscale'?{upscaleMode:'whole-resample' as const}:{}),sourceImageId:image.id,sourceWidth:s.width,sourceHeight:s.height,width,height,originalDataURL,prompt:kind==='upscale'?`整图 AI 修复：保持完整原图 ${s.width}:${s.height} 的比例和边界，锁定主体身份、数量、位置、逐字文案、颜色及光照。三稿只用于整体轮廓、大色块与明暗层级；线稿已去除细碎纹理，不要补描或复制原图中的蚯蚓纹、噪点和融化瑕疵，不把这些瑕疵当作真实结构。细节应按正常材质自然重建，不能照描参考图每一道微小线条。只修复受损材质，不重做设计、不增加纹理噪点或锐化光晕。输出模型原生尽可能清晰的完整 PNG，不切块、不拼接，不强求目标像素。之后插件会统一重采样到 ${width}×${height}，这不是模型原生目标分辨率。`:actionPrompt(kind,width,height)});
      onCreated(job,image);setSize(null);setHd(null);
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
    </div>
    {hd&&<div className="modal-shade" onPointerDown={e=>e.stopPropagation()}><section className="modal generation-modal" role="dialog" aria-modal="true" aria-label="智能高清">
      <h2>智能高清 · 整图修复</h2><p>先由 AI 修复完整画面的模糊与受损纹理，再统一放大至所选尺寸。不切块、不拼接；用原图和三稿约束构图，仍需核对文字与细节。</p>
      <div className="ratio-grid">{([2,4] as const).map(factor=><button key={factor} disabled={busy} aria-pressed={hd.factor===factor} onClick={()=>setHd({...hd,factor})}>×{factor}<small>{hd.width*factor} × {hd.height*factor} px</small></button>)}</div>
      <p>{hdError||'预计 1 次整图生图，失败最多额外重试 1 次。'} 最后一步为本地 Lanczos 重采样，并非原生 ×2/×4 超分细节；不会保证恢复已丢失的信息。最大边 8192px、3200 万像素，原图保留。</p>
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
