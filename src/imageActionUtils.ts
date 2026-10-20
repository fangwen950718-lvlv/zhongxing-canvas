import type { ImageJob } from './ImageGenerator';

export function originalFile(dataURL: string, name: string) {
  const match = dataURL.match(/^data:(image\/[\w.+-]+)(;base64)?,(.*)$/s);
  if (!match) throw new Error('图片文件数据无效，请重新导入原图。');
  const raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = match[2] ? Uint8Array.from(raw, c => c.charCodeAt(0)) : new TextEncoder().encode(raw);
  const extensions: Record<string,string> = { 'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg','image/avif':'avif' };
  return { blob: new Blob([bytes], { type: match[1] }), name: `${name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').slice(0,100)}.${extensions[match[1]] || 'img'}` };
}
export function actionPrompt(kind: 'relayout' | 'remove-background', width: number, height: number) {
  return kind === 'relayout'
    ? `将唯一输入原图重新布局为 ${width}×${height} 像素的 PNG。按新画幅重排构图，不是直接拉伸、裁切或加边框。保留原图所有主体、元素、Logo、文字内容与视觉风格，不新增、删减、翻译或改写。逐字读取并核对原文。仅调整位置、层级、间距与必要的等比缩放，使版式完整自然。不要添加箭头、标注、水印或新文案。`
    : `去除唯一输入原图的干净背景，仅保留主体。保持主体身份、颜色、文字、边缘和细节，不裁掉主体。允许按完整主体边界收紧画幅，输出像素尺寸、比例不必与原图一致；不要为对齐原图尺寸反复生成、补边或拉伸。输出带真实 alpha 通道的透明背景 PNG；不要白色背景、棋盘格背景、底板或新投影。`;
}
export function commandForImageJob(job: ImageJob) {
  const skill = ['relayout','remove-background'].includes(job.kind || '') ? 'zhongxing-canvas-image-action' : job.kind === 'edit' ? 'zhongxing-canvas-image-edit' : 'zhongxing-canvas-image-gen';
  return `这是众行画布发起的图片任务。使用 $${skill} 处理任务 ${job.id}，读取原图与任务要求，调用 Codex 内置图片编辑工具，完成后回填真实结果；不要覆盖原图。`;
}
export function imageActionFrame(job: Pick<ImageJob,'width'|'height'>, near?: { width:number; height:number }) {
  const width = near?.width || 400;
  return { width, height: width * job.height / job.width };
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
  const width=Math.min(340,Math.max(0,viewport.width-24));
  const columns=Math.max(1,Math.min(4,Math.floor((width-12+5)/69)));
  const rows=Math.ceil(4/columns),height=rows*32+(rows-1)*5+12;
  const angle=image.angle||0;
  const boundsHeight=Math.abs(Math.sin(angle))*image.width+Math.abs(Math.cos(angle))*image.height;
  const centerX=(image.x+image.width/2+viewport.scrollX)*viewport.zoom.value;
  const topY=(image.y+image.height/2-boundsHeight/2+viewport.scrollY)*viewport.zoom.value;
  return {
    left:Math.max(12,Math.min(viewport.width-width-12,centerX-width/2)),
    top:Math.max(12,Math.min(viewport.height-height-12,topY-height-10)),
  };
}
