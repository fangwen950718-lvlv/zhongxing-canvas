import { useEffect, useRef, useState } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { CaptureUpdateAction, convertToExcalidrawElements } from '@excalidraw/excalidraw';

type Tool = 'hand'|'selection'|'rectangle'|'ellipse'|'diamond'|'arrow'|'line'|'freedraw'|'text'|'eraser';
type Shape = 'rectangle'|'ellipse'|'diamond'|'star';
const shapeNames: Record<Shape,string> = {rectangle:'矩形',ellipse:'圆形 / 椭圆',diamond:'菱形',star:'星形'};
export function ToolIcon({name}:{name:string}) {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{
    name==='rectangle'?<rect x="4" y="5" width="16" height="14" rx="1"/>:
    name==='ellipse'?<circle cx="12" cy="12" r="8"/>:
    name==='diamond'?<path d="M12 3 21 12 12 21 3 12Z"/>:
    name==='star'?<path d="m12 2 3 6.5 7 1-5 5 1.2 7-6.2-3.4L5.8 21l1.2-6.5-5-5 7-1Z"/>:
    name==='selection'?<path d="m5 3 14 10-7 1-3 7Z"/>:
    name==='hand'?<path d="M8 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v5c0 6-3 8-7 8-3 0-5-3-6-5l-3-4c-1-2 1-3 2-2l2 2"/>:
    name==='arrow'?<path d="M3 12h17m-6-6 6 6-6 6"/>:
    name==='line'?<path d="M4 19 20 5"/>:
    name==='freedraw'?<path d="m4 18-1 3 4-1L20 7l-3-3Z M14 7l3 3"/>:
    name==='text'?<path d="M5 5h14M12 5v15m-4 0h8"/>:
    name==='image'?<><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 6-5 4 4 3-3 5 5"/></>:
    name==='eraser'?<path d="m3 14 10-11 8 7-10 11H8Zm5-5 8 7M11 21h10"/>:
    <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="M20 2v4m-2-2h4"/></>
  }</svg>;
}
export function starPoints(width:number,height:number): [number,number][] {
  const points: [number,number][] = Array.from({length:10},(_,i)=>{
    const angle=-Math.PI/2+i*Math.PI/5, radius=i%2?0.43:1;
    return [width/2+Math.cos(angle)*width/2*radius,height/2+Math.sin(angle)*height/2*radius];
  });
  return [...points,points[0]];
}
export default function CanvasToolbar({api,activeTool,onImage,onGenerate}:{api:ExcalidrawImperativeAPI|null;activeTool:string;onImage:()=>void;onGenerate:()=>void}){
  const [shape,setShape]=useState<Shape>('rectangle'),[menu,setMenu]=useState(false),[star,setStar]=useState(false),[drag,setDrag]=useState<{x:number;y:number;endX:number;endY:number}|null>(null);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null),longPressed=useRef(false),root=useRef<HTMLDivElement>(null);
  const clearTimer=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;};
  useEffect(()=>{const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setMenu(false);}; const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setMenu(false);setStar(false);setDrag(null);}};document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);return()=>{clearTimer();document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};},[]);
  useEffect(()=>{if(['rectangle','ellipse','diamond'].includes(activeTool))setShape(activeTool as Shape);},[activeTool]);
  function selectTool(tool:Tool){setStar(false);setDrag(null);setMenu(false);api?.setActiveTool({type:tool});}
  function selectShape(next:Shape){setShape(next);setMenu(false);if(next==='star'){api?.setActiveTool({type:'selection'});setStar(true);}else selectTool(next);}
  return <>
    <div ref={root} className="zx-toolbar" role="toolbar" aria-label="众行画布工具" onKeyDown={e=>e.stopPropagation()}>
      {([['hand','抓手'],['selection','选择']] as const).map(([tool,label])=><button key={tool} aria-label={label} title={label} aria-pressed={!star&&activeTool===tool} onClick={()=>selectTool(tool)}><ToolIcon name={tool}/></button>)}
      <div className="shape-tool"><button aria-label="图形工具（长按展开）" title="图形工具 · 长按或点击展开" aria-haspopup="menu" aria-expanded={menu} aria-pressed={star||['rectangle','ellipse','diamond'].includes(activeTool)} onPointerDown={()=>{longPressed.current=false;clearTimer();timer.current=setTimeout(()=>{longPressed.current=true;setMenu(true);},350);}} onPointerUp={clearTimer} onPointerCancel={clearTimer} onPointerLeave={clearTimer} onClick={()=>{if(!longPressed.current)setMenu(v=>!v);}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setMenu(true);}}}><ToolIcon name={shape}/><span className="chevron">⌄</span></button>
      {menu&&<div className="shape-menu" role="menu" aria-label="选择图形">{(Object.keys(shapeNames) as Shape[]).map(s=><button role="menuitem" key={s} onClick={()=>selectShape(s)}><ToolIcon name={s}/><span>{shapeNames[s]}</span>{s===shape&&<span>✓</span>}</button>)}</div>}</div>
      {([['arrow','箭头'],['line','线条'],['freedraw','画笔'],['text','文字']] as const).map(([tool,label])=><button key={tool} aria-label={label} title={label} aria-pressed={!star&&activeTool===tool} onClick={()=>selectTool(tool)}><ToolIcon name={tool}/></button>)}
      <button aria-label="导入图片" title="导入图片" onClick={onImage}><ToolIcon name="image"/></button><button aria-label="橡皮" title="橡皮" aria-pressed={activeTool==='eraser'} onClick={()=>selectTool('eraser')}><ToolIcon name="eraser"/></button>
      <span className="tool-separator"/><button className="ai-tool" aria-label="AI 生图" title="AI 生图" onClick={()=>{setStar(false);setMenu(false);onGenerate();}}><ToolIcon name="ai"/><span>生图</span></button>
    </div>
    {star&&<div className="star-draw-layer" onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);const rect=e.currentTarget.getBoundingClientRect();const x=e.clientX-rect.left,y=e.clientY-rect.top;setDrag({x,y,endX:x,endY:y});}} onPointerMove={e=>{if(!drag)return;const rect=e.currentTarget.getBoundingClientRect();setDrag({...drag,endX:e.clientX-rect.left,endY:e.clientY-rect.top});}} onPointerCancel={()=>{setDrag(null);setStar(false);}} onPointerUp={e=>{if(!drag||!api)return;const rect=e.currentTarget.getBoundingClientRect();const endX=e.clientX-rect.left,endY=e.clientY-rect.top;const click=Math.abs(endX-drag.x)+Math.abs(endY-drag.y)<8;const w=click?120:Math.abs(endX-drag.x),h=click?120:Math.abs(endY-drag.y);const s=api.getAppState(),z=s.zoom.value;const x=(Math.min(drag.x,endX))/z-s.scrollX,y=(Math.min(drag.y,endY))/z-s.scrollY;const el=convertToExcalidrawElements([{type:'line',x,y,width:w/z,height:h/z,points:starPoints(w/z,h/z),strokeColor:s.currentItemStrokeColor,backgroundColor:s.currentItemBackgroundColor,fillStyle:s.currentItemFillStyle,strokeWidth:s.currentItemStrokeWidth,roughness:0,roundness:null}]);api.updateScene({elements:[...api.getSceneElements(),...el],captureUpdate:CaptureUpdateAction.IMMEDIATELY});setStar(false);setDrag(null);}}><span className="draw-hint">拖动绘制星形 · Esc 取消</span>{drag&&<svg className="star-preview"><polygon points={starPoints(Math.abs(drag.endX-drag.x),Math.abs(drag.endY-drag.y)).map(([x,y])=>`${x+Math.min(drag.x,drag.endX)},${y+Math.min(drag.y,drag.endY)}`).join(' ')} fill="#edf3e980" stroke="#506b48"/></svg>}</div>}
  </>;
}
