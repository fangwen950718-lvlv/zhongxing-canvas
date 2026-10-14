import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Excalidraw,
  MainMenu,
  exportToBlob,
  exportToSvg,
  convertToExcalidrawElements,
  CaptureUpdateAction,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  BinaryFileData,
} from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import "./style.css";
import {
  BUILD,
  cleanAppState,
  emptyProject,
  parseProject,
  rules,
  type Project,
  type CreativeOption,
} from "./project";
import { loadProject, saveProject, saveLocation } from "./storage";
import CanvasToolbar from './CanvasToolbar';
import ImageGenerator, { type ImageJob } from './ImageGenerator';
import AnnotationEditor from './AnnotationEditor';
import { createBriefJob, getBriefJob, getImageJob, requestCanvasFullscreen, sendCodexMessage } from './codexBridge';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { defaultRulePreset, rulePresets, type RuleLibrary } from './creativeRules';

function resolveRuleLibrary(project: Project): RuleLibrary {
  const id = project.ruleLibraryId || project.rulePreset || defaultRulePreset;
  const custom = project.customRuleLibraries?.find((library) => library.id === id);
  if (custom) return { id: custom.id, label: custom.name, description: '用户上传的完整审美规则库。', rules: custom.content, source: 'uploaded' };
  return rulePresets[id as keyof typeof rulePresets] || rulePresets[defaultRulePreset];
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
  await Promise.all(
    Object.values(p.scene.files).map(async (f) => {
      const image = new Image();
      image.src = f.dataURL;
      await image.decode();
    }),
  );
  return p;
}
function App({ initial, loadError }: { initial: Project; loadError: string }) {
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
  const knowledgeInput = useRef<HTMLInputElement>(null);
  const [editorApi,setEditorApi]=useState<ExcalidrawImperativeAPI|null>(null);
  const [activeTool,setActiveTool]=useState('selection');
  const [showImageGenerator,setShowImageGenerator]=useState(false);
  const [imageGeneratorPrompt,setImageGeneratorPrompt]=useState('');
  const [briefJobId,setBriefJobId]=useState('');
  const [briefBusy,setBriefBusy]=useState(false);
  const [briefProgress,setBriefProgress]=useState('');
  const [selectedImageId,setSelectedImageId]=useState('');
  const [selectedImageAction,setSelectedImageAction]=useState<{left:number;top:number}|null>(null);
  const [annotationImageId,setAnnotationImageId]=useState('');
  const polling=useRef(false);
  const [jobStatus,setJobStatus]=useState('');
  function placeImageJob(job:ImageJob, near?:ExcalidrawElement){
    const a=api.current;if(!a)return;const s=a.getAppState();const existing=a.getSceneElements();
    const width=near?.width||400,height=near?.height||400*job.height/job.width;
    const x=near?near.x+near.width+60:existing.length?Math.max(...existing.map(e=>e.x+e.width))+60:-s.scrollX+s.width/(2*s.zoom.value)-width/2;
    const y=near?.y??(-s.scrollY+s.height/(2*s.zoom.value)-height/2);
    const elements=convertToExcalidrawElements([{type:'rectangle',x,y,width,height,roughness:0,strokeColor:'#8aa27a',backgroundColor:'#f1f5ec',fillStyle:'solid',strokeStyle:'dashed',label:{text:`AI 生图 · 等待 Codex\n${job.ratio}\n${job.prompt.slice(0,70)}`,fontSize:16,fontFamily:2}}]);
    const decorated=elements.map(e=>({...e,customData:{zhongxingImageJobId:job.id}}));
    a.updateScene({elements:[...existing,...decorated],captureUpdate:CaptureUpdateAction.IMMEDIATELY});a.scrollToContent(decorated);setJobStatus('任务已准备，正在发送到 Codex。');
  }
  useEffect(()=>{const timer=setInterval(async()=>{
    const a=api.current;if(!a||polling.current)return;
    const holders=a.getSceneElements().filter(e=>e.type==='rectangle'&&typeof e.customData?.zhongxingImageJobId==='string'&&!live.current.imageJobReceipts?.includes(e.customData.zhongxingImageJobId));if(!holders.length)return;
    polling.current=true;
    try{for(const holder of holders){
      const id=holder.customData!.zhongxingImageJobId as string;
      const job:ImageJob=await getImageJob(id);
      if(job.status!=='completed'||!job.dataURL){const events=(job.progressEvents||[]).slice(-3).map(event=>`• ${event.text}`).join('\n');setJobStatus(job.status==='failed'?`生图未完成：${job.message||'请在 Codex 中查看原因'}`:`${job.progress||0}% · ${job.message||'等待 Codex 开始处理…'}${job.codexThreadId?`\nCodex 任务 ${job.codexThreadId.slice(0,8)}…`:''}${events?`\n${events}`:''}`);continue;}
      const img=new Image();img.src=job.dataURL;await img.decode();
      // Re-check after asynchronous work: never insert into a switched project or deleted frame.
      const current=a.getSceneElements();const target=current.find(e=>e.id===holder.id);if(!target)continue;
      const ratio=Math.min(target.width/img.width,target.height/img.height);const w=img.width*ratio,h=img.height*ratio;
      const fileId=job.id as BinaryFileData['id'];a.addFiles([{id:fileId,mimeType:job.mimeType as BinaryFileData['mimeType'],dataURL:job.dataURL as BinaryFileData['dataURL'],created:Date.now()}]);
      const image=convertToExcalidrawElements([{type:'image',fileId,x:target.x+(target.width-w)/2,y:target.y+(target.height-h)/2,width:w,height:h,status:'saved',customData:{zhongxingCompletedJobId:job.id,prompt:job.prompt,ratio:job.ratio}}]);
      update({...live.current,imageJobReceipts:[...(live.current.imageJobReceipts||[]),job.id]});
      a.updateScene({elements:[...current.filter(e=>e.customData?.zhongxingImageJobId!==job.id),...image],captureUpdate:CaptureUpdateAction.IMMEDIATELY});setJobStatus('生成图片已放回画布，正在本地保存。');
    }}catch{setJobStatus('暂未取得生成结果，本地任务仍保留；请确认服务运行后重试。');}finally{polling.current=false;}
  },2000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{if(!briefJobId)return;const timer=setInterval(async()=>{try{const job=await getBriefJob(briefJobId);const options=job.options?.length?job.options:(job.proposal&&job.imagePrompt?[{title:'方案',proposal:job.proposal,imagePrompt:job.imagePrompt}]:[]);if(job.status==='completed'&&options.length){update({...live.current,aiOptions:options,aiSelectedOption:0,aiProposal:options[0].proposal,aiImagePrompt:options[0].imagePrompt});setBriefJobId('');setBriefBusy(false);setBriefProgress('');setNotice(options.length===3?'三组方案与提示词已生成，请选择一个方向。':'方案与 demo 级提示词已生成，可以直接生图。');}else if(job.status==='failed'){setBriefJobId('');setBriefBusy(false);setBriefProgress('');setNotice(`方案生成失败：${job.message||'请在 Codex 中查看原因'}`);}else{const events=(job.progressEvents||[]).slice(-2).map(event=>`• ${event.text}`).join('\n');setBriefProgress(`${job.progress||0}% · ${job.message||'Codex 正在整理视觉方案…'}${job.codexThreadId?`\nCodex 任务 ${job.codexThreadId.slice(0,8)}…`:''}${events?`\n${events}`:''}`);}}catch{/* 保留任务并继续轮询 */}},1800);return()=>clearInterval(timer);},[briefJobId]);
  const [backup, setBackup] = useState("");
  const [imageExport, setImageExport] = useState<{url:string;name:string}|null>(null);
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
      const scale = Math.min(1, 500 / img.width, 500 / img.height);
      const width = img.width * scale,
        height = img.height * scale;
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
      setNotice("图片已导入，可在画布上选择、移动和缩放。");
    } catch (e) {
      setNotice(`图片导入失败：${e instanceof Error ? e.message : "请重试"}`);
    } finally {
      if (imageInput.current) imageInput.current.value = "";
    }
  }
  const update = (p: Project) => {
    live.current = p;
    dirty.current = true;
    revision.current++;
    setStatus(paused.current ? "自动保存已暂停" : "等待保存…");
    setProject(p);
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
    } catch {
      setStatus("保存失败 · 请导出备份");
      setNotice(
        "浏览器存储失败。当前内容仍在页面中，请立即导出项目备份；检查磁盘空间及浏览器存储权限。",
      );
    } finally {
      saving.current = false;
    }
  }
  useEffect(() => {
    const timer = setInterval(() => void flush(), 650);
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
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", leave);
    };
  }, []);
  function exportProject() {
    const text = JSON.stringify(
      { ...live.current, savedAt: new Date().toISOString() },
      null,
      2,
    );
    download(
      new Blob([text], { type: "application/json" }),
      `${live.current.name.replace(/[\\/:*?"<>|]/g, "_") || "众行项目"}.zhongxing.json`,
    );
    setBackup(text);
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
    lastScene.current = "";
    update(pending);
    setEpoch((x) => x + 1);
    setPending(null);
    setNotice("项目已导入，正在保存到本机浏览器。");
  }
  async function submitBrief() {
    const brief=(live.current.creativeBrief||'').trim();
    if(!brief){setNotice('请先输入生图 brief。');return;}
    setBriefBusy(true);setNotice('');
    try{
      const library=resolveRuleLibrary(live.current);
      const job=await createBriefJob({brief,rulePreset:library.id,ruleLabel:library.label,ruleText:library.rules});setBriefJobId(job.id);
      const sent=job.automationStarted || await sendCodexMessage(`这是由众行画布发起的视觉方案任务。使用 $zhongxing-canvas-brief 处理任务 ${job.id}。依据任务内指定的知识规则并列输出 3 个差异明确的 OP，每个 OP 配套一个 demo 级生图提示词，并回填画布。`);
      if(!sent&&!job.handoffQueued&&!job.automationStarted){setBriefJobId('');setBriefBusy(false);setNotice('当前页面不能调用 Codex。请从 Codex 插件中重新打开众行画布后重试。');}
    }catch(error){setBriefBusy(false);setNotice(`方案任务创建失败：${error instanceof Error?error.message:'请重试'}`);}
  }
  async function importKnowledge(file?: File) {
    if (!file) return;
    try {
      if (!/\.(md|txt|json)$/i.test(file.name)) throw new Error('请选择 Markdown、TXT 或 JSON 文本文件。');
      if (file.size > 120 * 1024) throw new Error('知识文件请小于 120 KB。');
      const text = await file.text();
      if (!text.trim()) throw new Error('知识文件没有可用文字。');
      const id = `uploaded-${crypto.randomUUID()}`;
      const name = file.name.replace(/\.(md|txt|json)$/i, '');
      const library = { id, name, content: text.slice(0, 120000), createdAt: new Date().toISOString() };
      update({ ...live.current, ruleLibraryId: id, customRuleLibraries: [...(live.current.customRuleLibraries || []), library], customKnowledgeName: '', customKnowledge: '', aiOptions: [], aiProposal: '', aiImagePrompt: '' });
      setNotice(`审美规则库「${name}」已添加并选中。`);
    } catch (error) {
      setNotice(`知识文件读取失败：${error instanceof Error ? error.message : '请重试'}`);
    } finally {
      if (knowledgeInput.current) knowledgeInput.current.value = '';
    }
  }
  async function exportImage(type: "png" | "svg") {
    try {
      if (!api.current) return;
      const opts = {
        elements: api.current.getSceneElements(),
        appState: { ...api.current.getAppState(), exportBackground: true },
        files: api.current.getFiles(),
      };
      if (!opts.elements.length) throw new Error("请先在画布中添加内容。");
      const blob =
        type === "png"
          ? await exportToBlob({ ...opts, mimeType: "image/png" })
          : new Blob([(await exportToSvg(opts)).outerHTML], {
              type: "image/svg+xml",
            });
      download(blob, `${live.current.name}.${type}`);
      setImageExport({url:URL.createObjectURL(blob),name:`${live.current.name}.${type}`});
    } catch (e) {
      setNotice(`导出失败：${e instanceof Error ? e.message : "请重试"}`);
    }
  }
  const annotationImage=annotationImageId&&api.current?.getSceneElements().find(element=>element.id===annotationImageId&&element.type==='image');
  const creativeOptions=project.aiOptions?.length?project.aiOptions:(project.aiProposal&&project.aiImagePrompt?[{title:'方案',proposal:project.aiProposal,imagePrompt:project.aiImagePrompt}]:[]);
  const selectedOption=creativeOptions[Math.min(project.aiSelectedOption||0,creativeOptions.length-1)];
  const selectedLibrary=resolveRuleLibrary(project);
  const customLibraries=project.customRuleLibraries||[];
  const displaySections=(option?:CreativeOption)=>option?.sections?.length?option.sections:null;
  function setCanvasMode(key:'objectsSnapModeEnabled'|'gridModeEnabled',enabled:boolean){
    const a=api.current;if(!a)return;
    const current=a.getAppState();const other=key==='objectsSnapModeEnabled'?'gridModeEnabled':'objectsSnapModeEnabled';
    a.updateScene({appState:{...current,[key]:enabled,[other]:enabled?false:current[other]},captureUpdate:CaptureUpdateAction.IMMEDIATELY});
  }
  return (
    <div className="app">
      {showImageGenerator&&<ImageGenerator initialPrompt={imageGeneratorPrompt} onClose={()=>setShowImageGenerator(false)} onCreated={placeImageJob}/>} 
      {jobStatus&&<div className="job-status" role="status">✧ {jobStatus}<button onClick={()=>setJobStatus('')}>收起</button></div>}
      <header>
        <div className="brand">
          <div className="zone-mark" role="img" aria-label="众行">ZONE<span>∞</span></div>
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
        <nav>
          <button onClick={() => input.current?.click()}>导入项目</button>
          <button onClick={exportProject}>导出项目</button>
          <button onClick={() => void exportImage("png")}>PNG</button>
          <button onClick={() => void exportImage("svg")}>SVG</button>
        </nav>
        <input
          hidden
          ref={input}
          type="file"
          accept=".json,.zhongxing.json"
          onChange={(e) => void importProject(e.target.files?.[0])}
        />
        <input hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif" ref={imageInput} onChange={(e) => void importImage(e.target.files?.[0])} />
        <input hidden type="file" accept=".md,.txt,.json,text/plain,text/markdown,application/json" ref={knowledgeInput} onChange={(e) => void importKnowledge(e.target.files?.[0])} />
      </header>
      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          {paused.current && (
            <button
              onClick={() => {
                if (
                  confirm(
                    "恢复自动保存会覆盖数据库中的旧记录。请确认已保留所需备份。",
                  )
                ) {
                  paused.current = false;
                  dirty.current = true;
                  void flush();
                }
              }}
            >
              恢复保存
            </button>
          )}
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
                  onChange={(event) => update({ ...live.current, creativeBrief: event.target.value, aiOptions: [], aiProposal: '', aiImagePrompt: '' })}
                />
              </label>
              <div className="knowledge-settings">
                <label>
                  审美规则
                  <select value={selectedLibrary.id} onChange={(event)=>update({...live.current,ruleLibraryId:event.target.value,rulePreset:Object.hasOwn(rulePresets,event.target.value)?event.target.value:live.current.rulePreset,aiOptions:[],aiProposal:'',aiImagePrompt:''})}>
                    <optgroup label="系统内置">
                      {Object.values(rulePresets).map((preset)=><option key={preset.id} value={preset.id}>{preset.label}</option>)}
                    </optgroup>
                    {customLibraries.length>0&&<optgroup label="我的知识库">{customLibraries.map((library)=><option key={library.id} value={library.id}>{library.name}</option>)}</optgroup>}
                  </select>
                </label>
                <button className="knowledge-upload" onClick={()=>knowledgeInput.current?.click()}>＋ 上传规则</button>
              </div>
              <div className="knowledge-note"><span className="knowledge-origin">{selectedLibrary.source==='built-in'?'系统内置':'我的知识库'}</span>{selectedLibrary.description}{selectedLibrary.source==='uploaded'&&<button aria-label="删除当前知识库" title="删除当前知识库" onClick={()=>update({...live.current,ruleLibraryId:defaultRulePreset,customRuleLibraries:customLibraries.filter((library)=>library.id!==selectedLibrary.id),aiOptions:[],aiProposal:'',aiImagePrompt:''})}>删除</button>}</div>
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
                </section>
              )}
              {selectedOption?.imagePrompt && (
                <section className="ai-result prompt">
                  <div className="section-label">Demo 提示词</div>
                  <textarea readOnly rows={8} value={selectedOption.imagePrompt} />
                  <button className="primary" onClick={() => { setImageGeneratorPrompt(selectedOption.imagePrompt); setShowImageGenerator(true); }}>
                    用此提示词生图 <span>✦</span>
                  </button>
                </section>
              )}
              <details className="rules-compact"><summary>当前审美规则 · {selectedLibrary.label}</summary><pre>{`${selectedLibrary.rules}\n\n众行通用底层规则\n${rules}`}</pre></details>
            </div>
          )}
        </aside>
        <main>
          <CanvasToolbar api={editorApi} activeTool={activeTool} onImage={()=>imageInput.current?.click()} onGenerate={()=>{setImageGeneratorPrompt('');setShowImageGenerator(true);}}/>
          {selectedImageId&&selectedImageAction&&!annotationImageId&&<div className="selection-action" style={selectedImageAction}><button onClick={()=>setAnnotationImageId(selectedImageId)}>↗ 修改标注</button></div>}
          <Excalidraw
            key={epoch}
            excalidrawAPI={(instance) => {
              api.current = instance;
              setEditorApi(instance);
            }}
            langCode="zh-CN"
            theme="light"
            initialData={project.scene}
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
              setActiveTool(appState.activeTool.type);
              const selectedIds=Object.keys(appState.selectedElementIds).filter(id=>appState.selectedElementIds[id]);
              const selected=selectedIds.length===1?elements.find(element=>element.id===selectedIds[0]&&element.type==='image'):undefined;
              setSelectedImageId(selected?.id||'');
              if(selected){
                const zoom=appState.zoom.value;
                const left=Math.min(appState.width-150,Math.max(12,(selected.x+appState.scrollX+selected.width)*zoom+12));
                const top=Math.min(appState.height-52,Math.max(82,(selected.y+appState.scrollY)*zoom));
                setSelectedImageAction(previous=>previous&&Math.abs(previous.left-left)<0.5&&Math.abs(previous.top-top)<0.5?previous:{left,top});
              }else setSelectedImageAction(null);
              const scene = {
                elements,
                appState: cleanAppState(appState),
                files,
              };
              const signature = JSON.stringify(scene);
              if (signature !== lastScene.current) {
                lastScene.current = signature;
                update({ ...live.current, scene });
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
      {imageExport && <div className="modal-shade"><section className="modal" role="dialog" aria-modal="true" aria-label="图像导出预览"><h2>图像已生成</h2><p>已请求下载；若浏览器未保存，可使用下方链接或右键保存预览图片。</p><img alt="导出的画布图像" src={imageExport.url} style={{width:'100%',maxHeight:'50vh',objectFit:'contain'}}/><p><a href={imageExport.url} download={imageExport.name}>保存 {imageExport.name}</a></p><button onClick={()=>setImageExport(null)}>关闭图像预览</button></section></div>}
      {backup && (
        <div className="modal-shade">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="项目备份"
          >
            <h2>项目备份已准备</h2>
            <p>
              已请求浏览器下载。若没有下载文件，可选中下面的完整
              JSON，复制并另存为 UTF-8 的 .zhongxing.json 文件。包含图片数据。
            </p>
            <textarea
              aria-label="完整项目 JSON"
              readOnly
              value={backup}
              rows={8}
              style={{ width: "100%" }}
              onFocus={(e) => e.target.select()}
            />
            <button onClick={() => setBackup("")}>完成备份预览</button>
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
  createRoot(document.getElementById("root")!).render(
    <App initial={initial} loadError={loadError} />,
  );
}
void start();
