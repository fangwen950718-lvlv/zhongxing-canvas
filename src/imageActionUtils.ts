import type { ImageJob } from './ImageGenerator';
export function imageJobLabel(kind?:ImageJob['kind']) {return kind==='upscale'?'智能高清':kind==='relayout'?'延展尺寸':kind==='remove-background'?'去除背景':'AI 生图';}
export function pngPixelSize(dataURL:string) {
  if(!dataURL.startsWith('data:image/png;base64,'))return;
  try{const bytes=Uint8Array.from(atob(dataURL.slice(22,66)),c=>c.charCodeAt(0));
    if(bytes.length<24||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71)return;
    const view=new DataView(bytes.buffer),width=view.getUint32(16),height=view.getUint32(20);
    if(width>0&&height>0)return {width,height};
  }catch{/* fall back to browser decoding for malformed headers */}
}

export function originalFile(dataURL: string, name: string) {
  const match = dataURL.match(/^data:(image\/[\w.+-]+)(;base64)?,(.*)$/s);
  if (!match) throw new Error('图片文件数据无效，请重新导入原图。');
  const raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = match[2] ? Uint8Array.from(raw, c => c.charCodeAt(0)) : new TextEncoder().encode(raw);
  const extensions: Record<string,string> = { 'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg','image/avif':'avif' };
  return { blob: new Blob([bytes], { type: match[1] }), name: `${name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').slice(0,100)}.${extensions[match[1]] || 'img'}` };
}
export function actionPrompt(kind: 'relayout' | 'remove-background' | 'upscale', width: number, height: number) {
  if(kind==='upscale')return `智能高清重绘为 ${width}×${height} 像素真实 PNG。原图是唯一编辑目标；线稿锁定构图与轮廓，配色稿锁定大色块，灰度稿锁定明暗体积。三张稿仅作结构约束，不能把线稿或色块纹理画进成品。保持主体身份、数量、位置、比例、视角、Logo 与逐字文案、整体色彩一致。只重建受损细节，修复多轮编辑的蚯蚓纹、融化、噪点和不合理材质；不要改设计、加物件或过度锐化。必须调用图像生成工具重新生成，不可用普通插值放大或复制原图充数；若模型不能达到目标像素，请明确失败而不是伪造完成。`;
  return kind === 'relayout'
    ? `将唯一输入原图重新布局为 ${width}×${height} 像素的 PNG。按新画幅重排构图，不是直接拉伸、裁切或加边框。保留原图所有主体、元素、Logo、文字内容与视觉风格，不新增、删减、翻译或改写。逐字读取并核对原文。仅调整位置、层级、间距与必要的等比缩放，使版式完整自然。不要添加箭头、标注、水印或新文案。`
    : `去除唯一输入原图的干净背景，仅保留主体。保持主体身份、颜色、文字、边缘和细节，不裁掉主体。允许按完整主体边界收紧画幅，输出像素尺寸、比例不必与原图一致；不要为对齐原图尺寸反复生成、补边或拉伸。输出带真实 alpha 通道的透明背景 PNG；不要白色背景、棋盘格背景、底板或新投影。`;
}
export function commandForImageJob(job: ImageJob) {
  const skill = ['relayout','remove-background','upscale'].includes(job.kind || '') ? 'zhongxing-canvas-image-action' : job.kind === 'edit' ? 'zhongxing-canvas-image-edit' : job.presetId==='title'?'zhongxing-canvas-title-lettering':'zhongxing-canvas-image-gen';
  return `这是众行画布发起的图片任务。使用 $${skill} 处理任务 ${job.id}，读取原图与任务要求，调用 Codex 内置图片编辑工具，完成后回填真实结果；不要覆盖原图。`;
}
export function imageActionFrame(job: Pick<ImageJob,'width'|'height'>, near?: { width:number; height:number }) {
  return { width:job.width, height:job.height };
}
export function nextImagePosition(frame:{x:number;y:number;width:number;height:number}, existing:readonly {x:number;y:number;width:number;height:number;isDeleted?:boolean}[]) {
  let x=frame.x;
  for(let attempts=0;attempts<=existing.length;attempts++) {
    const overlaps=existing.filter(e=>!e.isDeleted&&x<e.x+e.width+20&&x+frame.width+20>e.x&&frame.y<e.y+e.height+20&&frame.y+frame.height+20>e.y);
    if(!overlaps.length)return {x,y:frame.y};
    x=Math.max(...overlaps.map(e=>e.x+e.width))+60;
  }
  return {x,y:frame.y};
}
export function imageActionsPosition(image:{x:number;y:number;width:number;height:number;angle?:number}, viewport:{width:number;height:number;scrollX:number;scrollY:number;zoom:{value:number}}) {
  const width=Math.min(480,Math.max(0,viewport.width-24));
  const columns=Math.max(1,Math.min(6,Math.floor((width-12+5)/69)));
  const rows=Math.ceil(6/columns),height=rows*32+(rows-1)*5+12;
  const angle=image.angle||0;
  const boundsHeight=Math.abs(Math.sin(angle))*image.width+Math.abs(Math.cos(angle))*image.height;
  const centerX=(image.x+image.width/2+viewport.scrollX)*viewport.zoom.value;
  const topY=(image.y+image.height/2-boundsHeight/2+viewport.scrollY)*viewport.zoom.value;
  return {
    left:Math.max(12,Math.min(viewport.width-width-12,centerX-width/2)),
    top:Math.max(12,Math.min(viewport.height-height-12,topY-height-10)),
  };
}
