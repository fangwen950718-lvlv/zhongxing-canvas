import { useState } from 'react';
import { createImageJob, sendCodexMessage } from './codexBridge';
import ReferenceImagePicker, { type ReferenceImageInput } from './ReferenceImagePicker';

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
  kind?: 'generate' | 'edit' | 'relayout' | 'remove-background';
  sourceImageId?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  handoffQueued?: boolean;
  automationStarted?: boolean;
  progress?: number;
  codexThreadId?: string;
  progressEvents?: Array<{ at: string; text: string }>;
}

type HandoffStatus = 'idle' | 'sending' | 'sent' | 'unavailable';

const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'];

const commandForJob = (jobId: string) =>
  `使用 $zhongxing-canvas-image-gen 处理众行画布生图任务 ${jobId}。读取该任务，调用 Codex 内置生图工具生成真实图片，并在完成后自动回填对应画布图片框。`;

export default function ImageGenerator({
  onClose,
  onCreated,
  initialPrompt = '',
}: {
  onClose: () => void;
  onCreated: (job: ImageJob) => void;
  initialPrompt?: string;
}) {
  const [ratio, setRatio] = useState('1:1');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState<ImageJob | null>(null);
  const [handoff, setHandoff] = useState<HandoffStatus>('idle');
  const [referenceImages, setReferenceImages] = useState<ReferenceImageInput[]>([]);

  async function createJob() {
    setBusy(true);
    setError('');
    try {
      const data = await createImageJob(prompt, ratio, referenceImages);

      setJob(data);
      onCreated(data);
      setHandoff('sending');

      const sent = data.automationStarted || await sendCodexMessage(
        `这是由众行画布发起的本机生图任务。${commandForJob(data.id)}`,
      );
      const accepted = Boolean(sent || data.handoffQueued || data.automationStarted);
      setHandoff(accepted ? 'sent' : 'unavailable');
      if (!accepted) {
        setError('当前是本地开发预览，不能调用 Codex。请从 Codex 中打开“众行画布”后直接生图。');
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '无法创建任务，请从 Codex 插件中重新打开众行画布。',
      );
    } finally {
      setBusy(false);
    }
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
            <h2>AI 生图</h2>
          </div>
          <button onClick={onClose} aria-label="关闭生图面板">
            ×
          </button>
        </div>
        <p>选择画面比例，描述你想要的图像。</p>

        <label className="field">画面比例</label>
        <div className="ratio-grid">
          {ratios.map((value) => (
            <button
              disabled={busy || !!job}
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
            disabled={busy || !!job}
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
          disabled={busy || !!job}
        />
        <p className="footnote">
          在 Codex 插件界面中会自动发起生图；普通浏览器会保留复制指令的回退方式。
        </p>

        {error && (
          <p role="alert" className="generation-error">
            {error}
          </p>
        )}

        {!job ? (
          <button
            className="primary"
            disabled={busy || !prompt.trim()}
            onClick={createJob}
          >
            {busy ? '正在创建任务…' : '开始生图 →'}
          </button>
        ) : (
          <div className="generation-handoff">
            <h3>
              {handoff === 'sending' && '正在发送到 Codex…'}
              {handoff === 'sent' && 'Codex 已接收，进度会显示在画布右下角'}
              {handoff === 'unavailable' && '当前页面无法连接 Codex'}
            </h3>
            <p>
              {handoff === 'sent'
                ? '可以关闭面板。生成完成后，图片会自动回到当前图片框。'
                : '画布已添加对应图片框；生成期间不要删除它。'}
            </p>

            <p className="footnote">
              {handoff === 'sent'
                ? 'Codex 已收到任务；实际生图会计入当前账户可用额度。'
                : '独立浏览器预览不会消耗 Codex 额度。'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
