import { useRef, useState } from 'react';
import ReferenceImagePicker, { type ReferenceImageInput } from './ReferenceImagePicker';
import PresetLibrary from './PresetLibrary';
import type {GenerationDraft, GenerationParams} from './generationParams';

export interface ImageJob {
  id: string;
  prompt: string;
  ratio: string;
  width: number;
  height: number;
  status: string;
  dataURL?: string;
  mimeType?: string;
  message?: string;
  kind?: 'generate' | 'edit' | 'relayout' | 'remove-background' | 'upscale';
  sourceImageId?: string;
  presetId?:string;
  quality?:{method:string;generated:boolean;qualityGuaranteed:boolean};
  sourceWidth?: number;
  upscaleMode?: 'tiled'|'whole-resample'|'texture-preserve';
  processing?: {method:string;nativeWidth:number;nativeHeight:number;targetWidth:number;targetHeight:number;nativeImageName:string};
  sourceHeight?: number;
  handoffQueued?: boolean;
  automationStarted?: boolean;
  progress?: number;
  codexThreadId?: string;
  progressEvents?: Array<{ at: string; text: string }>;
}

const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'];

export default function ImageGenerator({
  onClose,
  onSubmit,
  initialPrompt = '',
  initialParams,
  initialReferences=[],
  ruleText='',ruleLabel='',
}: {
  onClose: () => void;
  onSubmit: (draft:GenerationDraft) => boolean;
  initialPrompt?: string;
  initialParams?:GenerationParams|null;
  initialReferences?:ReferenceImageInput[];
  ruleText?:string;ruleLabel?:string;
}) {
  const [ratio, setRatio] = useState(initialParams?.ratio||'1:1');
  const [prompt, setPrompt] = useState(initialParams?.prompt??initialPrompt);
  const [preset,setPreset]=useState(initialParams?.preset??null);
  const [busy, setBusy] = useState(false);
  const [error,setError]=useState('');
  const submitted=useRef(false);
  const [referenceImages, setReferenceImages] = useState<ReferenceImageInput[]>(initialReferences);
  function createJob() {
    if(submitted.current||!prompt.trim())return;
    submitted.current=true;setError('');
    const accepted=onSubmit({prompt,ratio,preset,referenceImages,ruleText:initialParams?.ruleText??ruleText,ruleLabel:initialParams?.ruleLabel??ruleLabel});
    if(accepted)setBusy(true);
    else {submitted.current=false;setError('上一项请求仍在提交，或画布尚未就绪。输入已保留，请稍后重试。');}
  }

  return (
    <div className="modal-shade" onKeyDown={(event) => event.stopPropagation()}>
      <section
        className="modal generation-modal"
        role="dialog"
        aria-modal="true"
        aria-label="AI 生图"
      >
        <div className="generation-heading">
          <div>
            <div className="eyebrow">CODEX / IMAGE STUDIO</div>
            <h2>{initialParams?'生图参数':'AI 生图'}</h2>
          </div>
          <button onClick={onClose} aria-label="关闭生图面板">
            ×
          </button>
        </div>
        <p>选择画面比例，描述你想要的图像。</p>
        {initialParams&&<p className="footnote">模式：文字 / 参考图生图 · 原任务请求 {initialParams.width} × {initialParams.height}px（实际输出由模型决定）。复用原规则与预设快照，可编辑后再生成，原图不变。</p>}
        <PresetLibrary initial={initialParams?.preset} base={prompt} disabled={busy} onApply={(text,next)=>{setPrompt(text);setPreset(next);if(next?.id==='title')setRatio('16:9');}}/>
        {(initialParams?.ruleLabel??ruleLabel)&&<p className="footnote">叠加审美规则：{initialParams?.ruleLabel??ruleLabel}。预设只补充质感，不改变方案分类。</p>}
        {initialParams&&initialReferences.length<initialParams.references.length&&<p role="alert">部分参考图文件缺失，请重新添加后再生成。</p>}

        <label className="field">画面比例</label>
        <div className="ratio-grid">
          {ratios.map((value) => (
            <button
              disabled={busy}
              aria-pressed={ratio === value}
              key={value}
              onClick={() => setRatio(value)}
            >
              <span style={{ width: 22, height: 22, display: 'grid', placeItems: 'center' }}>
                <span
                  style={{
                    display: 'block',
                    border: '1.5px solid currentColor',
                    width:
                      Number(value.split(':')[0]) >= Number(value.split(':')[1])
                        ? 22
                        : (22 * Number(value.split(':')[0])) /
                          Number(value.split(':')[1]),
                    aspectRatio: value.replace(':', '/'),
                  }}
                />
              </span>
              {value}
            </button>
          ))}
        </div>

        <label className="field">
          图片提示词
          <textarea
            autoFocus
            disabled={busy}
            rows={5}
            maxLength={12000}
            placeholder="主体、场景、风格、光线、构图、需要避免的内容…"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <ReferenceImagePicker
          value={referenceImages}
          onChange={setReferenceImages}
          disabled={busy}
        />
        <p className="footnote">
          在 Codex 插件界面中会自动发起生图；普通浏览器会保留复制指令的回退方式。
        </p>

          <button
            className="primary"
            disabled={busy || !prompt.trim()}
            onClick={createJob}
          >
            {busy ? '正在创建任务…' : '开始生图 →'}
          </button>
          {error&&<p role="alert">{error}</p>}
      </section>
    </div>
  );
}
