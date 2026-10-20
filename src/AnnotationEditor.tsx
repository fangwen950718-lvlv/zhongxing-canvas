import { useMemo, useState } from 'react';
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  exportToBlob,
} from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { createImageEditJob, sendCodexMessage } from './codexBridge';
import type { ImageJob } from './ImageGenerator';
import ReferenceImagePicker, { type ReferenceImageInput } from './ReferenceImagePicker';
import { groupImageAnnotations } from './annotationGroups';

type Point = { x: number; y: number };

const blobToDataURL = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export default function AnnotationEditor({
  api,
  image,
  onClose,
  onCreated,
  onStatus,
}: {
  api: ExcalidrawImperativeAPI;
  image: ExcalidrawElement;
  onClose: () => void;
  onCreated: (job: ImageJob, source: ExcalidrawElement) => void;
  onStatus: (message: string) => void;
}) {
  const [drag, setDrag] = useState<{ start: Point; end: Point } | null>(null);
  const [pending, setPending] = useState<{ start: Point; end: Point } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [referenceImages, setReferenceImages] = useState<ReferenceImageInput[]>([]);
  const annotations = useMemo(
    () =>
      api
        .getSceneElements()
        .filter((element) => element.customData?.zhongxingAnnotationTargetId === image.id),
    [api, image.id, pending, drag],
  );
  const state = api.getAppState();
  const zoom = state.zoom.value;
  const actionPosition = {
    left: Math.min(
      state.width - 260,
      Math.max(12, (image.x + state.scrollX + image.width) * zoom + 12),
    ),
    top: Math.min(state.height - 58, Math.max(82, (image.y + state.scrollY) * zoom)),
  };

  const toScene = (point: Point) => {
    const state = api.getAppState();
    return {
      x: point.x / state.zoom.value - state.scrollX,
      y: point.y / state.zoom.value - state.scrollY,
    };
  };

  function saveAnnotation() {
    if (!pending || !note.trim()) return;
    const start = toScene(pending.start);
    const end = toScene(pending.end);
    const groupId = crypto.randomUUID();
    const created = convertToExcalidrawElements([
      {
        type: 'arrow',
        x: start.x,
        y: start.y,
        points: [
          [0, 0],
          [end.x - start.x, end.y - start.y],
        ],
        strokeColor: '#e23d28',
        strokeWidth: 3,
        roughness: 0,
        endArrowhead: 'arrow',
        startArrowhead: null,
      },
      {
        type: 'text',
        x: end.x + 12,
        y: end.y - 12,
        text: note.trim(),
        fontSize: 18,
        fontFamily: 2,
        strokeColor: '#c92f1d',
      },
    ]).map((element) => ({
      ...element,
      groupIds: [groupId],
      customData: {
        zhongxingAnnotationTargetId: image.id,
        zhongxingAnnotationNote: note.trim(),
      },
    }));
    const grouped=groupImageAnnotations([...api.getSceneElements(),...created],image.id);
    const imageGroup=grouped.find(e=>e.id===image.id)?.customData?.zhongxingAnnotationGroupId as string;
    api.updateScene({
      elements: grouped,
      appState:{selectedElementIds:Object.fromEntries(grouped.filter(e=>!e.isDeleted&&(e.id===image.id||e.customData?.zhongxingAnnotationTargetId===image.id)).map(e=>[e.id,true])),selectedGroupIds:{[imageGroup]:true}},
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setPending(null);
    setNote('');
  }

  async function submit() {
    const currentAnnotations = api
      .getSceneElements()
      .filter((element) => element.customData?.zhongxingAnnotationTargetId === image.id);
    if (!currentAnnotations.length) {
      onStatus('请先拖出至少一条箭头并填写修改意见。');
      return;
    }
    setBusy(true);
    try {
      const appState = { ...api.getAppState(), exportBackground: true };
      const files = api.getFiles();
      const sourceFile = image.type === 'image' && image.fileId ? files[image.fileId] : undefined;
      if (!sourceFile) throw new Error('原图文件缺失，请重新导入图片');
      const sourceImage = new Image();
      sourceImage.src = sourceFile.dataURL;
      await sourceImage.decode();
      const [originalBlob, annotatedBlob] = await Promise.all([
        exportToBlob({ elements: [image], appState, files, mimeType: 'image/png' }),
        exportToBlob({
          elements: [image, ...currentAnnotations],
          appState,
          files,
          mimeType: 'image/png',
        }),
      ]);
      const notes = currentAnnotations
        .map((element) => element.customData?.zhongxingAnnotationNote)
        .filter((value, index, values) => typeof value === 'string' && values.indexOf(value) === index);
      const prompt = `根据箭头标注修改原图。\n${notes.map((value, index) => `${index + 1}. ${value}`).join('\n')}\n保持未标注区域、主体身份、构图与视觉风格不变；最终图片不包含箭头、批注文字或标记。`;
      const divisor = (a: number, b: number): number => (b ? divisor(b, a % b) : a);
      const roundedWidth = Math.max(1, sourceImage.naturalWidth);
      const roundedHeight = Math.max(1, sourceImage.naturalHeight);
      const common = divisor(roundedWidth, roundedHeight);
      const job = await createImageEditJob({
        prompt,
        ratio: `${roundedWidth / common}:${roundedHeight / common}`,
        width: roundedWidth,
        height: roundedHeight,
        originalDataURL: /^data:image\/(png|jpeg|webp);base64,/.test(sourceFile.dataURL) ? sourceFile.dataURL : await blobToDataURL(originalBlob),
        annotatedDataURL: await blobToDataURL(annotatedBlob),
        referenceImages,
      });
      onCreated(job, image);
      const sent = job.automationStarted || await sendCodexMessage(
        `这是由众行画布发起的图片标注修改任务。使用 $zhongxing-canvas-image-edit 处理任务 ${job.id}。读取原图、标注截图与意见，调用 Codex 内置生图工具修改，并把真实结果自动回填画布。`,
      );
      const accepted = Boolean(sent || job.handoffQueued || job.automationStarted);
      onStatus(
        accepted
          ? '修改任务已发送到 Codex，实时进度显示在画布右下角，完成后会自动回填到原图旁。'
          : '当前是本地开发预览，不能调用 Codex。请从 Codex 中打开“众行画布”后提交修改。',
      );
      if (accepted) onClose();
    } catch (error) {
      onStatus(`修改任务创建失败：${error instanceof Error ? error.message : '请重试'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        className="annotation-layer"
        onPointerDown={(event) => {
          if (busy || pending || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const rect = event.currentTarget.getBoundingClientRect();
          const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
          setDrag({ start: point, end: point });
        }}
        onPointerMove={(event) => {
          if (!drag) return;
          const rect = event.currentTarget.getBoundingClientRect();
          setDrag({ ...drag, end: { x: event.clientX - rect.left, y: event.clientY - rect.top } });
        }}
        onPointerUp={() => {
          if (!drag) return;
          if (Math.hypot(drag.end.x - drag.start.x, drag.end.y - drag.start.y) > 12) setPending(drag);
          setDrag(null);
        }}
      >
        <div className="annotation-help">在原图上拖出箭头 · 可连续添加多条</div>
        {drag && (
          <svg className="annotation-preview">
            <defs><marker id="zx-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#e23d28" /></marker></defs>
            <line x1={drag.start.x} y1={drag.start.y} x2={drag.end.x} y2={drag.end.y} stroke="#e23d28" strokeWidth="3" markerEnd="url(#zx-arrow)" />
          </svg>
        )}
      </div>
      <div className="annotation-actions" style={actionPosition}>
        <span>{annotations.filter(element => element.type === 'arrow').length} 条标注</span>
        <ReferenceImagePicker compact value={referenceImages} onChange={setReferenceImages} disabled={busy} />
        <button disabled={busy} onClick={onClose}>退出</button>
        <button className="primary compact" disabled={busy || !annotations.length} onClick={() => void submit()}>
          {busy ? '正在提交…' : '完成并修改'}
        </button>
      </div>
      {pending && (
        <div className="annotation-note" role="dialog" aria-modal="true" aria-label="填写修改意见">
          <strong>这条箭头要改什么？</strong>
          <textarea autoFocus rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：把这里的瓶盖改成银色金属材质" />
          <div><button onClick={() => { setPending(null); setNote(''); }}>取消</button><button className="primary compact" disabled={!note.trim()} onClick={saveAnnotation}>添加标注</button></div>
        </div>
      )}
    </>
  );
}
