import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import type {ExcalidrawImperativeAPI} from '@excalidraw/excalidraw/types';
import type {ExcalidrawElement} from '@excalidraw/excalidraw/element/types';
import {pngPixelSize} from './imageActionUtils';
export default function ImageSizeInfo({api,image}:{api:ExcalidrawImperativeAPI;image:ExcalidrawElement}) {
  const [target,setTarget]=useState<Element|null>(null),[size,setSize]=useState('正在读取…');
  useEffect(()=>{
    const refresh=()=>setTarget(document.querySelector('.selected-shape-actions .App-menu__left'));
    refresh();const observer=new MutationObserver(refresh);observer.observe(document.getElementById('root')!,{childList:true,subtree:true});return()=>observer.disconnect();
  },[]);
  const file=image.type==='image'&&image.fileId?api.getFiles()[image.fileId]:undefined;
  const hd=image.customData?.zhongxingHdProcessing as {nativeWidth?:unknown;nativeHeight?:unknown;resampled?:unknown}|undefined;
  useEffect(()=>{const header=file&&pngPixelSize(file.dataURL);if(header){setSize(`${header.width} × ${header.height} px`);return;}let active=true;const img=new Image();img.onload=()=>{if(active)setSize(`${img.naturalWidth} × ${img.naturalHeight} px`);};img.onerror=()=>{if(active)setSize('原图尺寸不可读');};if(file)img.src=file.dataURL;return()=>{active=false;img.onload=null;img.onerror=null;img.src='';};},[file?.dataURL]);
  return target?createPortal(<div className="image-size-info"><strong>图片尺寸</strong><span>原图：{size}</span><span>画布：{Math.round(image.width)} × {Math.round(image.height)}</span>{typeof hd?.nativeWidth==='number'&&typeof hd.nativeHeight==='number'&&<span>AI 原生：{hd.nativeWidth} × {hd.nativeHeight}<br/>{hd.resampled?'整图修复 + 本地重采样':'整图修复 · 原生尺寸'}</span>}</div>,target):null;
}
