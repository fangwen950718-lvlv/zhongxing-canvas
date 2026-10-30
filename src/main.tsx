import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
  CaptureUpdateAction,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  BinaryFileData,
} from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import "./style.css";
import "./reference-results.css";
import brandLogo from "../assets/zhongxing-logo.png";
import {
  BUILD,
  cleanAppState,
  emptyProject,
  parseProject,
  type Project,
  type CreativeOption,
} from "./project";
import { loadProject, saveProject, saveLocation } from "./storage";
import CanvasToolbar from './CanvasToolbar';
import ImageGenerator, { type ImageJob } from './ImageGenerator';
import {generationSnapshot,readGenerationParams,type GenerationParams,type GenerationDraft} from './generationParams';
import type {ReferenceImageInput} from './ReferenceImagePicker';
import AnnotationEditor from './AnnotationEditor';
import ImageActions from './ImageActions';
import { commandForImageJob, imageActionFrame, nextImagePosition, imageActionsPosition,imageJobLabel } from './imageActionUtils';
import { groupExistingAnnotations, selectedAnnotationImage } from './annotationGroups';
import {createSceneSignature} from './sceneSignature';
import ImageSizeInfo from './ImageSizeInfo';
import { CanvasReferences } from './CanvasReferences';
import { callTool, createImageJob, createBriefJob, getBriefJob, getImageJob, retryImageJob, cancelImageJob, exportSavedProject, requestCanvasFullscreen, sendCodexMessage } from './codexBridge';
import {projectBlobInWorker} from './projectExport';
import {createSaveSchedule} from './saveSchedule';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { defaultRulePreset, rulePresets, type RuleLibrary } from './creativeRules';
import RuleEditor from './RuleEditor';
import {CanvasRecovery,rememberCanvas} from './CanvasRecovery';
import { availableRules, applyRules, commonRules, effectiveRules } from './ruleLibraryState';

const defaultLibraries=Object.values(rulePresets).map(rule=>({id:rule.id,name:rule.label,content:rule.rules,createdAt:'2026-01-01T00:00:00.000Z'}));

function resolveRuleLibrary(project: Project): RuleLibrary {
  const id = project.ruleLibraryId || project.rulePreset || defaultRulePreset;
  const libraries=availableRules(project,defaultLibraries);
  const library=libraries.find(rule=>rule.id===id)||libraries[0];
  return {id:library?.id||'',label:library?.name||'暂无规则',description:'',rules:library?.content||'',source:'uploaded'};
}

function proposalParagraphs(proposal: string) {
  const explicit = proposal.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  if (explicit.length > 1) return explicit;
  const sentences = proposal.match(/[^。！？]+[。！？]?/g)?.map((part) => part.trim()).filter(Boolean) || [proposal];
  const paragraphs: string[] = [];
  for (let index = 0; index < sentences.length; index += 2) paragraphs.push(sentences.slice(index, index + 2).join(''));
  return paragraphs;
}

const canvasBackgrounds = [
  { color: '#fafaf8', label: '柔白' },
  { color: '#f3f4f1', label: '雾灰' },
  { color: '#eef2f5', label: '浅蓝灰' },
  { color: '#fff8df', label: '暖米' },
  { color: '#f8efec', label: '淡粉灰' },
  { color: '#ffffff', label: '纯白' },
  { color: '#111514', label: '墨黑' },
] as const;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function validateImages(p: Project) {
  // Validate one decoded bitmap at a time; retain all original file bytes.
  for(const file of Object.values(p.scene.files)){
    const image=new Image();try{image.src=file.dataURL;await image.decode();}finally{image.src='';}
  }
  return {...p,scene:{...p.scene,elements:groupExistingAnnotations(p.scene.elements)}};
}
function App({ initial, loadError }: { initial: Project; loadError: string }) {
  const initialScene=useRef(initial.scene);
  const [confirmSave,setConfirmSave]=useState(false);
  const renderTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const selectionTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const nextSelection=useRef<{id:string;position:{left:number;top:number}|null}>({id:'',position:null});
  const projectSerial=useRef(0);
  const [project, setProject] = useState(initial),
    [collapsed, setCollapsed] = useState(false),
    [status, setStatus] = useState(
      loadError ? "自动保存已暂停" : `已保存到${saveLocation()}`,
    ),
    [notice, setNotice] = useState(loadError),
    [pending, setPending] = useState<Project | null>(null),
    [epoch, setEpoch] = useState(0);
  const live = useRef(project),
    dirty = useRef(false),
    revision = useRef(0),
    saving = useRef(false),
    paused = useRef(!!loadError),
    api = useRef<ExcalidrawImperativeAPI | null>(null),
    input = useRef<HTMLInputElement>(null),
    lastScene = useRef("");
  const imageInput = useRef<HTMLInputElement>(null);
  const sceneSignature=useRef(createSceneSignature());
  const saveSchedule=useRef(createSaveSchedule());
  const sizedImages=useRef(new Set(initial.scene.elements.filter(e=>e.type==='image').map(e=>e.id)));
  const [showRuleEditor,setShowRuleEditor]=useState(false);
  const [editorApi,setEditorApi]=useState<ExcalidrawImperativeAPI|null>(null);
  const [activeTool,setActiveTool]=useState('selection');
  const [showImageGenerator,setShowImageGenerator]=useState(false);
  const [imageGeneratorPrompt,setImageGeneratorPrompt]=useState('');
  const [generatorParams,setGeneratorParams]=useState<GenerationParams|null>(null);
  const [generatorReferences,setGeneratorReferences]=useState<ReferenceImageInput[]>([]);
  const [missingParams,setMissingParams]=useState(false);
  const [failedGeneration,setFailedGeneration]=useState<{draft:GenerationDraft;token:string}|null>(null);
  const creatingGeneration=useRef(false);
  const [briefJobId,setBriefJobId]=useState('');
  const [briefBusy,setBriefBusy]=useState(false);
  const [briefProgress,setBriefProgress]=useState('');
  const [updateInfo,setUpdateInfo]=useState<{latest?:string;available?:boolean;message?:string;busy?:boolean}>({});
  async function checkPluginUpdate() {
    setUpdateInfo(previous=>({...previous,busy:true,message:'正在检查更新…'}));
    try {
      const result=await callTool('check_zhongxing_update',{}) as {structuredContent?:{latest:string;available:boolean;current:string}} | null;
      if(!result?.structuredContent)throw new Error('当前环境暂不支持检查更新');
      if(result.structuredContent.current.includes('-local.')) setUpdateInfo({latest:result.structuredContent.latest,available:false,message:`本机测试版 · 正式版 ${result.structuredContent.latest}`,busy:false});
      else setUpdateInfo({...result.structuredContent,message:result.structuredContent.available?'发现新版本':'已是最新正式版本',busy:false});
    } catch { setUpdateInfo({message:'暂时无法检查更新，请检查网络后重试。',busy:false}); }
  }
  async function installPluginUpdate() {
    setUpdateInfo(previous=>({...previous,busy:true,message:'正在更新，请不要关闭画布…'}));
    try {
      const result=await callTool('install_zhongxing_update',{}) as {structuredContent?:{version:string;message:string}} | null;
      if(!result?.structuredContent)throw new Error('当前环境暂不支持更新');
      setUpdateInfo({message:`${result.structuredContent.message}（${result.structuredContent.version}）`,busy:false});
    } catch(error) { setUpdateInfo(previous=>({...previous,busy:false,message:error instanceof Error?error.message:'更新失败，请重试。'})); }
  }
  useEffect(()=>{void checkPluginUpdate();},[]);
  const [referenceStatus,setReferenceStatus]=useState(initial.aiReferenceJobId ? '正在检查参考图任务…' : '');
  const [referenceAttempt,setReferenceAttempt]=useState(0);
  const [selectedImageId,setSelectedImageId]=useState('');
  const [selectedImageAction,setSelectedImageAction]=useState<{left:number;top:number}|null>(null);
  const [annotationImageId,setAnnotationImageId]=useState('');
  const polling=useRef(false);
  const [jobStatus,setJobStatus]=useState('');
  const [retryJobId,setRetryJobId]=useState('');
  const [retryBusy,setRetryBusy]=useState(false);
  const [activeTileJob,setActiveTileJob]=useState(''),[cancelBusy,setCancelBusy]=useState(false);
  useEffect(()=>{
    // A reload during submission must not leave an unexplained, forever-spinning frame.
    const holder=editorApi?.getSceneElements().find(e=>e.type==='rectangle'&&typeof e.customData?.zhongxingPendingGeneration==='string');
    const params=readGenerationParams(holder?.customData?.zhongxingGenerationParams);
    if(!holder||!params||!editorApi)return;
    const files=editorApi.getFiles();
    setFailedGeneration({token:holder.customData!.zhongxingPendingGeneration as string,draft:{prompt:params.prompt,ratio:params.ratio,preset:params.preset,ruleText:params.ruleText,ruleLabel:params.ruleLabel,referenceImages:params.references.flatMap(r=>files[r.id]?[{...r,dataURL:files[r.id].dataURL}]:[])}});
    setJobStatus('上次生图提交未完整结束，输入仍保留。请先核对当前对话是否已有任务，再选择“重新编辑生图”，避免重复生成。');
  },[editorApi]);
  async function stopTiles(){setCancelBusy(true);try{const job=await cancelImageJob(activeTileJob);setActiveTileJob('');setRetryJobId('');setJobStatus(job.message||'任务已中止');}catch(e){setJobStatus(String(e));}finally{setCancelBusy(false);}}
  async function resendImageJob() {
    if(!retryJobId||retryBusy)return;
    setRetryBusy(true);
    try {
      let job=await getImageJob(retryJobId);
      if(job.status==='failed') job=await retryImageJob(job.id);
      if(job.status==='completed') {setRetryJobId('');return;}
      const sent=await sendCodexMessage(commandForImageJob(job));
      setJobStatus(sent?'已重新发送图片任务，请查看当前对话进度。':'发送未成功，任务输入已保留，可再次重试。');
    }catch(error){setJobStatus(`重试失败：${error instanceof Error?error.message:error}`);}
    finally{setRetryBusy(false);}
  }
  function placeImageJob(job:ImageJob, near?:ExcalidrawElement,params?:GenerationParams,pending=false){
    const a=api.current;if(!a)return;const s=a.getAppState();const existing=a.getSceneElements();
    const {width,height}=imageActionFrame(job,near);
    const candidateX=near?near.x+near.width+60:existing.length?Math.max(...existing.map(e=>e.x+e.width))+60:-s.scrollX+s.width/(2*s.zoom.value)-width/2;
    const candidateY=near?.y??(-s.scrollY+s.height/(2*s.zoom.value)-height/2);
    const {x,y}=nextImagePosition({x:candidateX,y:candidateY,width,height},existing);
    const elements=convertToExcalidrawElements([{type:'rectangle',x,y,width,height,roughness:0,strokeColor:'#909090',backgroundColor:'#f2f2f2',fillStyle:'solid',strokeStyle:'dashed',label:{text:`${imageJobLabel(job.kind)} · ${pending?'正在提交…':'等待 Codex'}\n${job.width}×${job.height}\n${job.prompt.slice(0,70)}`,fontSize:16,fontFamily:2}}]);
    const decorated=elements.map(e=>({...e,customData:{[pending?'zhongxingPendingGeneration':'zhongxingImageJobId']:job.id,...(params?{zhongxingGenerationParams:params}:{})}}));
    a.updateScene({elements:[...existing,...decorated],captureUpdate:CaptureUpdateAction.IMMEDIATELY});a.scrollToContent(decorated);setRetryJobId('');setJobStatus('任务已准备，正在发送到 Codex。');
  }
  function openGenerator(prompt='',params:GenerationParams|null=null){
    const files=api.current?.getFiles()||{};
    setImageGeneratorPrompt(prompt);setGeneratorParams(params);
    setGeneratorReferences((params?.references||[]).flatMap(r=>files[r.id]?[{...r,dataURL:files[r.id].dataURL}]:[]));
    setShowImageGenerator(true);
  }
  async function submitGeneration(draft:GenerationDraft){
    if(creatingGeneration.current){setJobStatus('上一项生图请求仍在提交，请稍候，勿重复点击。');return;}
    const a=api.current;if(!a){setNotice('画布尚未就绪，请稍后再试。');return;}
    creatingGeneration.current=true;setShowImageGenerator(false);setFailedGeneration(null);
    const serial=projectSerial.current,token=crypto.randomUUID(),params=generationSnapshot(draft);
    try{
      a.addFiles(draft.referenceImages.map((ref,index)=>({id:params.references[index].id as BinaryFileData['id'],mimeType:ref.dataURL.slice(5,ref.dataURL.indexOf(';')) as BinaryFileData['mimeType'],dataURL:ref.dataURL as BinaryFileData['dataURL'],created:Date.now()})));
      placeImageJob({id:token,prompt:draft.prompt,ratio:draft.ratio,width:params.width,height:params.height,status:'queued'},undefined,params,true);
      setJobStatus('正在提交生图请求…画布占位框已保留，请勿重复提交。');
      const job=await createImageJob(draft.prompt,draft.ratio,draft.referenceImages,{presetId:draft.preset?.id||'',ruleText:draft.ruleText,ruleLabel:draft.ruleLabel});
      if(api.current!==a||serial!==projectSerial.current){setNotice(`生图任务 ${job.id} 已建立；原项目占位框保留，请回到原项目继续查看。`);return;}
      // Bind the server UUID to the existing frame, never create a second placeholder.
      a.updateScene({elements:a.getSceneElements().map(e=>e.customData?.zhongxingPendingGeneration===token?{...e,version:e.version+1,versionNonce:Math.floor(Math.random()*2147483647),updated:Date.now(),customData:{zhongxingImageJobId:job.id,zhongxingGenerationParams:{...params,width:job.width,height:job.height}},...(e.type==='text'?{text:`AI 生图 · 等待 Codex\n${job.width}×${job.height}\n${draft.prompt.slice(0,70)}`,originalText:`AI 生图 · 等待 Codex\n${job.width}×${job.height}\n${draft.prompt.slice(0,70)}`}:{})}:e),captureUpdate:CaptureUpdateAction.IMMEDIATELY});
      setJobStatus('任务已建立，正在发送到 Codex…');
      try{
        const sent=job.automationStarted||await sendCodexMessage(commandForImageJob(job));
        if(api.current!==a||serial!==projectSerial.current)return;
        if(!sent&&!job.handoffQueued){setRetryJobId(job.id);setJobStatus('任务已保留，但发送未成功。点击“重新发送 / 重试”，不会重复创建任务。');}
        else setJobStatus('Codex 已接收。画布占位框等待生成结果，可继续编辑其他内容。');
      }catch(e){if(api.current===a&&serial===projectSerial.current){setRetryJobId(job.id);setJobStatus(`任务已保留，发送失败：${e instanceof Error?e.message:e}。可重新发送。`);}}
    }catch(e){
      if(api.current===a&&serial===projectSerial.current){
        setFailedGeneration({draft,token});
        a.updateScene({elements:a.getSceneElements().map(el=>el.customData?.zhongxingPendingGeneration===token&&el.type==='text'?{...el,version:el.version+1,versionNonce:Math.floor(Math.random()*2147483647),updated:Date.now(),text:'提交失败 · 请点击“重新编辑生图”',originalText:'提交失败 · 请点击“重新编辑生图”'}:el),captureUpdate:CaptureUpdateAction.IMMEDIATELY});
        setJobStatus(`生图请求未完成：${e instanceof Error?e.message:e}。提示词已保留，可重新编辑后提交。`);
      }
    }finally{creatingGeneration.current=false;}
  }
  useEffect(()=>{const timer=setInterval(async()=>{
    const a=api.current;if(!a||polling.current)return;const serial=projectSerial.current;
    const holders=a.getSceneElements().filter(e=>e.type==='rectangle'&&typeof e.customData?.zhongxingImageJobId==='string'&&!live.current.imageJobReceipts?.includes(e.customData.zhongxingImageJobId));if(!holders.length)return;
    polling.current=true;
    try{for(const holder of holders){
      const id=holder.customData!.zhongxingImageJobId as string;
      const job:ImageJob=await getImageJob(id);
      if(api.current!==a||projectSerial.current!==serial)break;
      if(job.upscaleMode==='tiled')setActiveTileJob(previous=>['queued','running'].includes(job.status)?job.id:previous===job.id?'':previous);
      if(job.status==='failed')setRetryJobId(job.id);
      if(job.status==='running')setRetryJobId(previous=>previous===job.id?'':previous);
      if(job.status!=='completed'||!job.dataURL){const events=(job.progressEvents||[]).slice(-3).map(event=>`• ${event.text}`).join('\n');setJobStatus(job.status==='failed'?`生图未完成：${job.message||'请在 Codex 中查看原因'}`:`${typeof job.progress==="number"?`${job.progress}% · `:""}${job.message||'等待 Codex 开始处理…'}${job.codexThreadId?`\nCodex 任务 ${job.codexThreadId.slice(0,8)}…`:''}${events?`\n${events}`:''}`);continue;}
      const img=new Image();img.src=job.dataURL;await img.decode();
      if(api.current!==a||projectSerial.current!==serial){img.src='';break;}
      // Re-check after asynchronous work: never insert into a switched project or deleted frame.
      const current=a.getSceneElements();const target=current.find(e=>e.id===holder.id);if(!target)continue;
      const w=img.naturalWidth,h=img.naturalHeight;
      img.src='';
      const fileId=job.id as BinaryFileData['id'];a.addFiles([{id:fileId,mimeType:job.mimeType as BinaryFileData['mimeType'],dataURL:job.dataURL as BinaryFileData['dataURL'],created:Date.now()}]);
      const placement=nextImagePosition({x:target.x,y:target.y,width:w,height:h},current.filter(e=>e.customData?.zhongxingImageJobId!==job.id));
      const params=readGenerationParams(target.customData?.zhongxingGenerationParams);
      const image=convertToExcalidrawElements([{type:'image',fileId,...placement,width:w,height:h,status:'saved',customData:{zhongxingCompletedJobId:job.id,prompt:job.prompt,ratio:job.ratio,...(params?{zhongxingGenerationParams:params}:{}),...(job.processing?{zhongxingHdProcessing:job.processing}:{}),...(job.quality?{zhongxingTextureProcessing:job.quality}:{})}}]);
      update({...live.current,imageJobReceipts:[...(live.current.imageJobReceipts||[]),job.id]});
      a.updateScene({elements:[...current.filter(e=>e.customData?.zhongxingImageJobId!==job.id),...image],captureUpdate:CaptureUpdateAction.IMMEDIATELY});setRetryJobId(previous=>previous===job.id?'':previous);setJobStatus(job.upscaleMode==='texture-preserve'?job.message||'本地保真放大完成，非AI重绘':job.upscaleMode==='whole-resample'?`${job.message}。原图保留，请核对细节。`:job.kind==='upscale'?'高清重绘已放回画布，原图保留；请核对文字与细节。':job.kind==='relayout'?'延展图片已放回画布，请核对文字与细节。':job.kind==='remove-background'?'透明 PNG 已放回画布，原图已保留。':'生成图片已放回画布，正在本地保存。');
    }}catch{setJobStatus('暂未取得生成结果，本地任务仍保留；请确认服务运行后重试。');}finally{polling.current=false;}
  },2000);return()=>clearInterval(timer);},[]);
  async function sendReferenceSearch(id:string) {
    setReferenceStatus('正在发送参考图搜索任务…');
    try { if(!await callTool('reset_zhongxing_op_references',{id})) throw new Error('请在 Codex 中打开画布'); }
    catch { setReferenceStatus('参考图任务未启动，可点击重新查找。'); return; }
    setReferenceAttempt(attempt=>attempt+1);
    const sent=await sendCodexMessage(`这是众行画布的参考图任务。使用 $zhongxing-canvas-reference 读取方案任务 ${id}，逐个方向搜索并调用回填工具。方案已完成，请勿修改方案。`);
    if(live.current.aiReferenceJobId!==id)return;
    setReferenceStatus(sent?'正在查找各方向的参考图，可继续使用方案。':'参考图任务未发送，可点击重新查找。');
  }
  useEffect(()=>{if(!briefJobId)return;let active=true;let busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{const job=await getBriefJob(briefJobId);if(!active)return;const options=job.options?.length?job.options:(job.proposal&&job.imagePrompt?[{title:'方案',proposal:job.proposal,imagePrompt:job.imagePrompt}]:[]);if(job.status==='completed'&&options.length){update({...live.current,aiOptions:options,aiSelectedOption:0,aiProposal:options[0].proposal,aiImagePrompt:options[0].imagePrompt,aiReferenceJobId:job.id});setBriefJobId('');setBriefBusy(false);setBriefProgress('');setNotice(options.length===3?'三组方案与提示词已生成，请选择一个方向。':'方案与 demo 级提示词已生成，可以直接生图。');void sendReferenceSearch(job.id);}else if(job.status==='failed'){setBriefJobId('');setBriefBusy(false);setBriefProgress('');setNotice(`方案生成失败：${job.message||'请在 Codex 中查看原因'}`);}else{const events=(job.progressEvents||[]).slice(-2).map(event=>`• ${event.text}`).join('\n');setBriefProgress(`${job.progress||0}% · ${job.message||'Codex 正在整理视觉方案…'}${job.codexThreadId?`\nCodex 任务 ${job.codexThreadId.slice(0,8)}…`:''}${events?`\n${events}`:''}`);}}catch{/* 保留任务并继续轮询 */}finally{busy=false;}},1800);return()=>{active=false;clearInterval(timer);};},[briefJobId]);
  useEffect(()=>{const id=project.aiReferenceJobId;if(!id)return;let active=true;let busy=false;let attempts=0;const timer=setInterval(async()=>{if(busy)return;busy=true;try{const job=await getBriefJob(id);if(!active||live.current.aiReferenceJobId!==id)return;const groups=job.referenceGroups||[];const options=live.current.aiOptions||[];let changed=false;const next=options.map((option,index)=>{const group=groups[index];if(!group)return option;if(JSON.stringify(option.references||[])===JSON.stringify(group.references)&&option.referenceMessage===(group.message||''))return option;changed=true;return {...option,references:group.references,referenceMessage:group.message||''};});if(changed)update({...live.current,aiOptions:next});if(groups.length>=options.length&&options.length&&groups.slice(0,options.length).every(Boolean)){setReferenceStatus('参考图搜索已完成。');clearInterval(timer);}else if(++attempts>=150){setReferenceStatus('参考图暂未返回，可重新查找。');clearInterval(timer);}}catch{if(++attempts>=10){setReferenceStatus('参考图任务暂不可读，可重新查找。');clearInterval(timer);}}finally{busy=false;}},2000);return()=>{active=false;clearInterval(timer);};},[project.aiReferenceJobId,referenceAttempt]);
  const [projectExport,setProjectExport]=useState<{busy:boolean;message:string;path?:string;url?:string;name?:string;bytes?:number}|null>(null);
  const exporting=useRef(false);
  const [imageExport, setImageExport] = useState<{url:string;name:string;savedPath?:string}|null>(null);
  useEffect(() => () => { if(imageExport) URL.revokeObjectURL(imageExport.url); }, [imageExport]);
  async function importImage(file?: File) {
    if (!file || !api.current) return;
    try {
      if (
        ![
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/gif",
          "image/svg+xml",
          "image/avif",
        ].includes(file.type)
      )
        throw new Error("请选择 PNG、JPEG、WebP、GIF、SVG 或 AVIF 图片。");
      if (file.size > 20 * 1024 * 1024)
        throw new Error("单张图片请小于 20 MB。");
      const dataURL = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const img = new Image();
      img.src = dataURL;
      await img.decode();
      const id = crypto.randomUUID() as BinaryFileData["id"];
      const a = api.current;
      const state = a.getAppState();
      const width = img.naturalWidth,
        height = img.naturalHeight;
      const element = convertToExcalidrawElements([
        {
          type: "image",
          fileId: id,
          x: -state.scrollX + (state.width / state.zoom.value - width) / 2,
          y: -state.scrollY + (state.height / state.zoom.value - height) / 2,
          width,
          height,
          status: "saved",
        },
      ]);
      a.addFiles([
        {
          id,
          mimeType: file.type as BinaryFileData["mimeType"],
          dataURL: dataURL as BinaryFileData["dataURL"],
          created: Date.now(),
        },
      ]);
      a.updateScene({
        elements: [...a.getSceneElements(), ...element],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      img.src='';
      setNotice("图片已导入，可在画布上选择、移动和缩放。");
    } catch (e) {
      setNotice(`图片导入失败：${e instanceof Error ? e.message : "请重试"}`);
    } finally {
      if (imageInput.current) imageInput.current.value = "";
    }
  }
  const update = (p: Project,sceneOnly=false) => {
    saveSchedule.current.changed();
    live.current = p;
    dirty.current = true;
    revision.current++;
    rememberCanvas(p,!paused.current);
    setStatus(paused.current ? "自动保存已暂停" : "等待保存…");
    if(sceneOnly){if(!renderTimer.current)renderTimer.current=setTimeout(()=>{renderTimer.current=null;setProject(live.current);},80);}
    else {if(renderTimer.current)clearTimeout(renderTimer.current);renderTimer.current=null;setProject(p);}
  };
  async function flush() {
    if (!dirty.current || saving.current || paused.current) return;
    saving.current = true;
    const rev = revision.current;
    try {
      await saveProject({ ...live.current, savedAt: new Date().toISOString() });
      if (rev === revision.current) {
        dirty.current = false;
        setStatus(`已保存到${saveLocation()}`);
      }
      saveSchedule.current.success(rev!==revision.current);
    } catch {
      saveSchedule.current.failed();
      setStatus("保存失败 · 请导出备份");
      setNotice(
        "浏览器存储失败。当前内容仍在页面中，请立即导出项目备份；检查磁盘空间及浏览器存储权限。",
      );
    } finally {
      saving.current = false;
    }
  }
  useEffect(() => {
    const timer = setInterval(() => {if(saveSchedule.current.ready())void flush();}, 650);
    const hide = () => {
      if (document.hidden) void flush();
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("beforeunload", leave);
    return () => {
      if(renderTimer.current)clearTimeout(renderTimer.current);
      if(selectionTimer.current)clearTimeout(selectionTimer.current);
      api.current=null;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", leave);
    };
  }, []);
  async function exportProject() {
    if(exporting.current)return;exporting.current=true;
    setProjectExport({busy:true,message:'1 / 2 · 正在确认最新画布已保存…'});
    try{
      await new Promise(resolve=>setTimeout(resolve,0));
      const deadline=Date.now()+60000;
      while(saving.current){if(Date.now()>deadline)throw new Error('自动保存仍未完成，请稍后再试；当前画布未修改');await new Promise(resolve=>setTimeout(resolve,150));}
      if(!paused.current)await flush();
      const name=live.current.name;
      setProjectExport({busy:true,message:'2 / 2 · 正在写入完整项目文件，请勿关闭画布…'});
      let saved=null;
      if(!dirty.current&&!saving.current&&!paused.current)try{saved=await exportSavedProject(name);}catch(e){setProjectExport({busy:true,message:`本机直接保存失败，正在准备当前内容的浏览器备份：${e instanceof Error?e.message:String(e)}`});}
      if(saved){setProjectExport({busy:false,message:'导出完成 · 文件已实际保存到本机',path:saved.savedPath,bytes:saved.bytes});return;}
      const blob=await projectBlobInWorker({...live.current,savedAt:new Date().toISOString()});
      if(blob.size>100*1024*1024)throw new Error('项目超过 100MB 导入上限，请分项目整理后导出');
      const url=URL.createObjectURL(blob),filename=`${name.replace(/[\\/:*?"<>|]/g,'_')||'众行项目'}.zhongxing.json`;
      setProjectExport({busy:false,message:'项目文件已准备。请点击下方链接保存；网页无法确认浏览器是否已写入磁盘。',url,name:filename,bytes:blob.size});
    }catch(e){setProjectExport({busy:false,message:`导出未完成：${e instanceof Error?e.message:String(e)}。画布内容仍保留，可重试。`});}
    finally{exporting.current=false;}
  }
  async function importProject(file?: File) {
    if (!file) return;
    try {
      if (file.size > 100 * 1024 * 1024)
        throw new Error("项目超过 100 MB，请拆分内容。");
      setPending(
        await validateImages(parseProject(JSON.parse(await file.text()))),
      );
    } catch (e) {
      setNotice(
        `导入失败，原项目未更改：${e instanceof Error ? e.message : "文件或图片损坏"}`,
      );
    } finally {
      if (input.current) input.current.value = "";
    }
  }
  function replace() {
    if (!pending) return;
    projectSerial.current++;
    initialScene.current=pending.scene;
    sizedImages.current=new Set(pending.scene.elements.filter(e=>e.type==='image').map(e=>e.id));
    lastScene.current = "";
    update(pending);
    setEpoch((x) => x + 1);
    setPending(null);
    setNotice("项目已导入，正在保存到本机浏览器。");
  }
  async function submitBrief() {
    const brief=(live.current.creativeBrief||'').trim();
    if(!brief){setNotice('请先输入生图 brief。');return;}
    if(!resolveRuleLibrary(live.current).id){setNotice('请先在“编辑”中上传审美规则。');return;}
    setBriefBusy(true);setNotice('');
    try{
      const library=resolveRuleLibrary(live.current);
      const ruleText=effectiveRules(live.current,library);
      if(ruleText.length>120000)throw new Error('当前分类规则与通用底层规则合计超过 120000 字，请先精简内容。');
      const job=await createBriefJob({brief,rulePreset:library.id,ruleLabel:library.label,ruleText});setBriefJobId(job.id);
      const sent=job.automationStarted || await sendCodexMessage(`这是由众行画布发起的视觉方案任务。使用 $zhongxing-canvas-brief 处理任务 ${job.id}。依据任务内指定的知识规则并列输出 3 个差异明确的 OP，每个 OP 配套一个 demo 级生图提示词，并回填画布。`);
      if(!sent&&!job.handoffQueued&&!job.automationStarted){setBriefJobId('');setBriefBusy(false);setNotice('当前页面不能调用 Codex。请从 Codex 插件中重新打开众行画布后重试。');}
    }catch(error){setBriefBusy(false);setNotice(`方案任务创建失败：${error instanceof Error?error.message:'请重试'}`);}
  }
  const annotationImage=annotationImageId&&api.current?.getSceneElements().find(element=>element.id===annotationImageId&&element.type==='image');
  const actionImage=selectedImageId&&editorApi?.getSceneElements().find(e=>e.id===selectedImageId&&!e.isDeleted&&e.type==='image');
  const creativeOptions=project.aiOptions?.length?project.aiOptions:(project.aiProposal&&project.aiImagePrompt?[{title:'方案',proposal:project.aiProposal,imagePrompt:project.aiImagePrompt}]:[]);
  const selectedOption=creativeOptions[Math.min(project.aiSelectedOption||0,creativeOptions.length-1)];
  const selectedLibrary=resolveRuleLibrary(project);
  const libraries=availableRules(project,defaultLibraries);
  const displaySections=(option?:CreativeOption)=>option?.sections?.length?option.sections:null;
  function setCanvasMode(key:'objectsSnapModeEnabled'|'gridModeEnabled',enabled:boolean){
    const a=api.current;if(!a)return;
    const current=a.getAppState();const other=key==='objectsSnapModeEnabled'?'gridModeEnabled':'objectsSnapModeEnabled';
    a.updateScene({appState:{...current,[key]:enabled,[other]:enabled?false:current[other]},captureUpdate:CaptureUpdateAction.IMMEDIATELY});
  }
  return (
    <div className="app">
      {showImageGenerator&&<CanvasReferences.Provider value={editorApi}><ImageGenerator initialPrompt={imageGeneratorPrompt} initialParams={generatorParams} initialReferences={generatorReferences} ruleText={effectiveRules(project,selectedLibrary)} ruleLabel={selectedLibrary.label} onClose={()=>setShowImageGenerator(false)} onSubmit={draft=>{if(creatingGeneration.current||!api.current)return false;void submitGeneration(draft);return true;}}/></CanvasReferences.Provider>}
      {missingParams&&<div className="modal-shade"><section className="modal" role="dialog" aria-modal="true" aria-label="生图参数"><h2>生图参数</h2><p>该图无参数记录</p><p className="footnote">导入图片或未保存参数的历史图片，无法准确还原当时的设置。</p><button onClick={()=>setMissingParams(false)}>关闭</button></section></div>}
      {failedGeneration&&<div className="generation-retry"><button onClick={()=>{const {draft,token}=failedGeneration;const a=api.current;a?.updateScene({elements:a.getSceneElements().filter(el=>el.customData?.zhongxingPendingGeneration!==token),captureUpdate:CaptureUpdateAction.IMMEDIATELY});setFailedGeneration(null);setImageGeneratorPrompt(draft.prompt);setGeneratorParams(generationSnapshot(draft));setGeneratorReferences(draft.referenceImages);setShowImageGenerator(true);}}>重新编辑生图</button></div>}
      {jobStatus&&<div className="job-status" role="status">{jobStatus}{activeTileJob&&<button disabled={cancelBusy} onClick={()=>void stopTiles()}>{cancelBusy?'正在中止…':'中止后续分块'}</button>}{retryJobId&&<button disabled={retryBusy} onClick={()=>void resendImageJob()}>{retryBusy?'正在重发…':'重新发送 / 重试'}</button>}<button onClick={()=>setJobStatus('')}>收起</button></div>}
      <header>
        <div className="brand">
          <img className="brand-logo" src={brandLogo} alt="众行传播" />
        </div>
        <div className="project-meta">
          <input
            aria-label="项目名称"
            maxLength={200}
            value={project.name}
            onChange={(e) => update({ ...live.current, name: e.target.value })}
          />
          <span
            role="status"
            className={status.includes("失败") ? "save error" : "save"}
          >
            ● {status}
          </span>
        </div>
        <span className="version">{BUILD}</span>
        <span className="version" role="status">{updateInfo.message}{updateInfo.latest&&updateInfo.available?` · ${updateInfo.latest}`:''}</span>
        {updateInfo.available ? <button disabled={updateInfo.busy} onClick={()=>void installPluginUpdate()}>立即更新</button> : <button disabled={updateInfo.busy} onClick={()=>void checkPluginUpdate()}>检查更新</button>}
        <nav>
          <button onClick={() => input.current?.click()}>导入项目</button>
          <button disabled={projectExport?.busy} onClick={()=>void exportProject()}>导出项目</button>
        </nav>
        <input
          hidden
          ref={input}
          type="file"
          accept=".json,.zhongxing.json"
          onChange={(e) => void importProject(e.target.files?.[0])}
        />
        <input hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif" ref={imageInput} onChange={(e) => void importImage(e.target.files?.[0])} />
      </header>
      {showRuleEditor&&<RuleEditor libraries={libraries} commonText={commonRules(project)} onClose={()=>setShowRuleEditor(false)} onSave={(next,commonRulesText)=>{update({...applyRules(live.current,next,defaultLibraries),commonRulesText});setShowRuleEditor(false);setNotice('审美规则已保存。');}}/>}
      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          {paused.current && (confirmSave?<><span>恢复将写入当前内容，请先保留所需备份。</span><button onClick={()=>{paused.current=false;dirty.current=true;rememberCanvas(live.current,true);setConfirmSave(false);void flush().then(()=>{if(!dirty.current){setNotice('自动保存已恢复。');try{sessionStorage.removeItem('zhongxing-last-failure');}catch{}}});}}>确认恢复保存</button><button onClick={()=>setConfirmSave(false)}>取消</button></>:<button onClick={()=>setConfirmSave(true)}>恢复保存</button>)}
          <button onClick={() => setNotice("")}>关闭提示</button>
        </div>
      )}
      <div className="workspace">
        <aside
          className={collapsed ? "panel collapsed" : "panel"}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <button
            className="collapse"
            aria-label={collapsed ? "展开提案面板" : "折叠提案面板"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? "→" : "←"}
          </button>
          {!collapsed && (
            <div className="panel-content">
              <div className="eyebrow">ZHONGXING / CREATIVE WORKSPACE</div>
              <h1>方案助手</h1>
              <label className="field brief-only">
                生图 brief
                <textarea
                  maxLength={30000}
                  rows={7}
                  value={project.creativeBrief || ''}
                  placeholder="说清楚要做什么、给谁看、希望什么感觉。品牌、画面、文案和限制可以一起写在这里。"
                  onChange={(event) => update({ ...live.current, creativeBrief: event.target.value, aiOptions: [], aiProposal: '', aiImagePrompt: '', aiReferenceJobId: undefined })}
                />
              </label>
              <div className="knowledge-settings">
                <label>
                  审美规则
                  <select value={selectedLibrary.id} onChange={(event)=>update({...live.current,ruleLibraryId:event.target.value,rulePreset:Object.hasOwn(rulePresets,event.target.value)?event.target.value:live.current.rulePreset,aiOptions:[],aiProposal:'',aiImagePrompt:'',aiReferenceJobId:undefined})}>
                    {!libraries.length&&<option value="">暂无规则</option>}
                    {libraries.map(library=><option key={library.id} value={library.id}>{library.name}</option>)}
                  </select>
                </label>
                <button className="knowledge-upload" onClick={()=>setShowRuleEditor(true)}>编辑</button>
              </div>
              <button className="primary" disabled={briefBusy || !(project.creativeBrief || '').trim()} onClick={() => void submitBrief()}>
                {briefBusy ? 'Codex 正在整理…' : '生成方案'} <span>↗</span>
              </button>
              {briefBusy&&<div className="brief-progress" role="status"><span className="progress-pulse"/> {briefProgress||'正在启动 Codex 任务…'}</div>}
              {creativeOptions.length>0 && (
                <section className="ai-result">
                  <div className="section-label">选择创意方向</div>
                  <div className="op-tabs">{creativeOptions.map((option,index)=><button key={`${option.title}-${index}`} aria-pressed={(project.aiSelectedOption||0)===index} onClick={()=>update({...live.current,aiSelectedOption:index,aiProposal:option.proposal,aiImagePrompt:option.imagePrompt})}><span>OP {index+1}</span>{option.title}</button>)}</div>
                  <div className="proposal-copy">
                    {displaySections(selectedOption)?.length ? <>
                      <p className="proposal-summary">{selectedOption?.proposal}</p>
                      <div className="proposal-sections">{displaySections(selectedOption)?.map((section,index)=><div className="proposal-section" key={`${section.label}-${index}`}><h3>{section.label}</h3><p>{section.content}</p></div>)}</div>
                    </> : <div className="proposal-legacy">{proposalParagraphs(selectedOption?.proposal||'').map((paragraph,index)=><p key={index}>{paragraph}</p>)}</div>}
                  </div>
                  <div className="reference-results"><div className="reference-heading"><span>视觉参考</span>{project.aiReferenceJobId&&<button onClick={()=>void sendReferenceSearch(project.aiReferenceJobId!)}>重新查找</button>}</div>
                    {selectedOption?.references?.length ? <div className="reference-grid">{selectedOption.references.map((ref,index)=><a key={`${ref.pageUrl}-${index}`} href={ref.pageUrl} target="_blank" rel="noopener noreferrer">{ref.preview?<img src={ref.preview} alt={ref.title} loading="lazy"/>:<span className="reference-placeholder">查看来源</span>}<strong>{ref.title}</strong><small>{ref.source}</small>{ref.description&&<small>{ref.description}</small>}</a>)}</div> : <p>{selectedOption?.referenceMessage||referenceStatus||'暂无参考图。'}</p>}
                  </div>
                </section>
              )}
              {selectedOption?.imagePrompt && (
                <section className="ai-result prompt">
                  <div className="section-label">Demo 提示词</div>
                  <textarea readOnly rows={8} value={selectedOption.imagePrompt} />
                  <button className="primary" onClick={() => openGenerator(selectedOption.imagePrompt)}>
                    用此提示词生图 <span>✦</span>
                  </button>
                </section>
              )}
              <details className="rules-compact"><summary>当前审美规则 · {selectedLibrary.label}</summary><pre>{effectiveRules(project,selectedLibrary)}</pre></details>
            </div>
          )}
        </aside>
        <main>
          <CanvasToolbar api={editorApi} activeTool={activeTool} onImage={()=>imageInput.current?.click()} onGenerate={()=>openGenerator()}/>
          {actionImage&&editorApi&&<ImageSizeInfo api={editorApi} image={actionImage}/>}
          {actionImage&&selectedImageAction&&!annotationImageId&&editorApi&&<ImageActions key={selectedImageId} api={editorApi} image={actionImage} position={selectedImageAction} projectName={project.name} onParameters={()=>{const params=readGenerationParams(actionImage.customData?.zhongxingGenerationParams);if(params)openGenerator('',params);else setMissingParams(true);}} onAnnotate={()=>setAnnotationImageId(selectedImageId)} onCreated={placeImageJob} onStatus={setJobStatus} onRetryNeeded={setRetryJobId} onDownload={(blob,name,savedPath)=>{if(!savedPath)download(blob,name);setImageExport({url:URL.createObjectURL(blob),name,savedPath});}}/>}
          <Excalidraw
            key={epoch}
            excalidrawAPI={(instance) => {
              if (instance) requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event('zhongxing-canvas-ready'))));
              api.current = instance;
              setEditorApi(instance);
            }}
            langCode="zh-CN"
            theme="light"
            initialData={initialScene.current}
            name={project.name}
            isCollaborating={false}
            aiEnabled={false}
            autoFocus={false}
            UIOptions={{
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
                export: false,
                toggleTheme: false,
              },
              tools: { image: true },
            }}
            onChange={(elements, appState, files) => {
              // New paste/drop images use source pixels too. Existing project
              // elements and later user resizing are deliberately untouched.
              for(const element of elements)if(element.type==='image'&&!element.isDeleted&&element.fileId&&!sizedImages.current.has(element.id)&&files[element.fileId]){
                sizedImages.current.add(element.id);
                const a=api.current,file=files[element.fileId],img=new Image();img.src=file.dataURL;
                void img.decode().then(()=>{
                  if(!a||api.current!==a)return;
                  const current=a.getSceneElements(),found=current.find(e=>e.id===element.id);
                  if(!found||found.width!==element.width||found.height!==element.height||found.width===img.naturalWidth&&found.height===img.naturalHeight)return;
                  a.updateScene({elements:current.map(e=>e.id===found.id?{...e,width:img.naturalWidth,height:img.naturalHeight,version:e.version+1,versionNonce:Math.floor(Math.random()*2**31),updated:Date.now()}:e),captureUpdate:CaptureUpdateAction.IMMEDIATELY});
                }).catch(()=>{/* invalid source remains recoverable through import/export */}).finally(()=>{img.src='';});
              }
              setActiveTool(appState.activeTool.type);
              const selected=selectedAnnotationImage(elements,appState.selectedElementIds);
              nextSelection.current={id:selected?.id||'',position:selected?imageActionsPosition(selected,appState):null};
              if(!selectionTimer.current)selectionTimer.current=setTimeout(()=>{selectionTimer.current=null;const next=nextSelection.current;setSelectedImageId(next.id);setSelectedImageAction(previous=>previous&&next.position&&Math.abs(previous.left-next.position.left)<.5&&Math.abs(previous.top-next.position.top)<.5?previous:next.position);},80);
              const scene = {
                elements,
                appState: cleanAppState(appState),
                files,
              };
              const signature = sceneSignature.current(elements,scene.appState,files);
              if (signature !== lastScene.current) {
                lastScene.current = signature;
                update({ ...live.current, scene },true);
              }
            }}
          >
            <MainMenu>
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.ItemCustom className="background-palette">
                <div className="background-palette-heading"><span>画布背景</span><small>{project.scene.appState.viewBackgroundColor || '#fafaf8'}</small></div>
                <div className="background-swatches">{canvasBackgrounds.map(({color,label})=>{
                  const selected=(project.scene.appState.viewBackgroundColor||'#fafaf8').toLowerCase()===color;
                  return <button key={color} className={selected?'selected':''} title={`${label} · ${color}`} aria-label={`画布背景：${label}`} aria-pressed={selected} style={{background:color}} onClick={()=>api.current?.updateScene({appState:{viewBackgroundColor:color},captureUpdate:CaptureUpdateAction.IMMEDIATELY})}><span>✓</span></button>;
                })}</div>
              </MainMenu.ItemCustom>
              <MainMenu.Separator />
              <MainMenu.Item selected={!!project.scene.appState.objectsSnapModeEnabled} onSelect={()=>setCanvasMode('objectsSnapModeEnabled',!project.scene.appState.objectsSnapModeEnabled)}>对象吸附（图片适用）</MainMenu.Item>
              <MainMenu.Item selected={!!project.scene.appState.gridModeEnabled} onSelect={()=>setCanvasMode('gridModeEnabled',!project.scene.appState.gridModeEnabled)}>网格自动对齐</MainMenu.Item>
            </MainMenu>
          </Excalidraw>
          {annotationImage&&api.current&&<AnnotationEditor api={api.current} image={annotationImage} onClose={()=>setAnnotationImageId('')} onCreated={placeImageJob} onStatus={setJobStatus}/>} 
          <div className="canvas-caption">
            自由构思，从这里开始 · 空格拖动画布 · 滚轮平移 · ⌘ / Ctrl + 滚轮缩放
          </div>
        </main>
      </div>
      {pending && (
        <div className="modal-shade">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="替换当前项目"
          >
            <h2>导入「{pending.name}」？</h2>
            <p>
              文件验证通过。导入将替换当前画布、图片和提案草稿；建议先导出当前项目备份。
            </p>
            <button onClick={exportProject}>先导出当前项目</button>
            <button onClick={() => setPending(null)}>取消</button>
            <button className="primary" onClick={replace}>
              确认替换
            </button>
          </section>
        </div>
      )}
      {imageExport && <div className="modal-shade"><section className="modal" role="dialog" aria-modal="true" aria-label="图像导出预览"><h2>图片已准备</h2><p>{imageExport.savedPath?`原图已保存到：${imageExport.savedPath}`:'已请求下载；若浏览器未保存，可使用下方链接或右键保存预览图片。'} 棋盘格仅用于预览透明区域，不会写入文件。</p><img className="transparency-preview" alt="完整图片预览" src={imageExport.url} style={{width:'100%',maxHeight:'50vh',objectFit:'contain'}}/><p><a href={imageExport.url} download={imageExport.name}>保存 {imageExport.name}</a></p><button onClick={()=>setImageExport(null)}>关闭图像预览</button></section></div>}
      {projectExport && (
        <div className="modal-shade">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="项目备份"
          >
            <h2>导出项目</h2><p role="status">{projectExport.message}</p>
            {projectExport.busy&&<progress aria-label="项目导出处理中"/>}
            {projectExport.path&&<p style={{overflowWrap:'anywhere'}}>{projectExport.path}</p>}
            {typeof projectExport.bytes==='number'&&<p>{(projectExport.bytes/1024/1024).toFixed(2)} MB · 包含画布图片、批注、方案与规则，可通过“导入项目”恢复。</p>}
            {projectExport.url&&<p><a href={projectExport.url} download={projectExport.name}>保存 {projectExport.name}</a></p>}
            <button disabled={projectExport.busy} onClick={()=>{if(projectExport.url){const url=projectExport.url;setTimeout(()=>URL.revokeObjectURL(url),60000);}setProjectExport(null);}}>关闭</button>
          </section>
        </div>
      )}
    </div>
  );
}
async function start() {
  if (window.parent !== window) {
    void requestCanvasFullscreen();
  }
  let initial = emptyProject(),
    loadError = "";
  try {
    const saved = await loadProject();
    if (saved) initial = await validateImages(parseProject(saved));
  } catch {
    loadError =
      "无法读取本地项目，未覆盖原记录。请保留浏览器数据，或导入已有项目备份；恢复保存前请确认。";
  }
  rememberCanvas(initial,!loadError);
  window.dispatchEvent(new Event('zhongxing-data-ready'));
  try{if(sessionStorage.getItem('zhongxing-last-failure')){sessionStorage.removeItem('zhongxing-last-failure');if(!loadError)loadError='上次画布曾异常中断，已读取最后保存的项目；请核对最近操作，确认后再恢复自动保存。';}}catch{}
  createRoot(document.getElementById("root")!).render(<CanvasRecovery initial={initial} loadError={loadError}>{(p,error)=><App initial={p} loadError={error}/>}</CanvasRecovery>);
}
void start();
