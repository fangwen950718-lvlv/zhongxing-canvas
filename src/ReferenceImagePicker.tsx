import { useContext, useRef, useState } from 'react';
import { CanvasReferences } from './CanvasReferences';

export interface ReferenceImageInput {
  id: string;
  name: string;
  dataURL: string;
}

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const acceptedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('参考图读取失败'));
    reader.readAsDataURL(file);
  });

const estimatedDataBytes = (dataURL: string) => {
  const payload = dataURL.slice(dataURL.indexOf(',') + 1);
  return Math.floor((payload.length * 3) / 4);
};

export default function ReferenceImagePicker({
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  value: ReferenceImageInput[];
  onChange: (images: ReferenceImageInput[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [showCanvas, setShowCanvas] = useState(false);
  const canvas = useContext(CanvasReferences);
  const canvasImages = canvas?.getSceneElements().filter(element => element.type === 'image' && !element.isDeleted && !!element.fileId) || [];
  function addCanvasImage(element: typeof canvasImages[number]) {
    if (!canvas || element.type !== 'image' || !element.fileId) return;
    const file = canvas.getFiles()[element.fileId];
    if (!file || !acceptedTypes.has(file.mimeType)) { setError('图片不可用或格式不支持，请先导入 PNG、JPEG 或 WebP。'); return; }
    const bytes = estimatedDataBytes(file.dataURL);
    if (bytes > MAX_FILE_BYTES || value.reduce((sum, item) => sum + estimatedDataBytes(item.dataURL), 0) + bytes > MAX_TOTAL_BYTES) { setError('每张参考图需小于 8MB，合计不超过 32MB。'); return; }
    if (value.some(item => item.id === `canvas:${element.id}`)) return;
    onChange([...value, { id: `canvas:${element.id}`, name: `画布图片 ${element.id.slice(0,8)}`, dataURL: file.dataURL }]);
    setError('');
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    try {
      const selected = Array.from(files);
      for (const file of selected) {
        if (!acceptedTypes.has(file.type)) throw new Error('参考图仅支持 PNG、JPEG 或 WebP。');
        if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('每张参考图需小于 8MB。');
      }
      const existingBytes = value.reduce((sum, image) => sum + estimatedDataBytes(image.dataURL), 0);
      const incomingBytes = selected.reduce((sum, file) => sum + file.size, 0);
      if (existingBytes + incomingBytes > MAX_TOTAL_BYTES) throw new Error('参考图合计需小于 32MB。');
      const added = await Promise.all(
        selected.map(async (file) => ({
          id: crypto.randomUUID(),
          name: file.name.slice(0, 160),
          dataURL: await readFile(file),
        })),
      );
      onChange([...value, ...added]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '参考图添加失败。');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className={`reference-picker${compact ? ' compact' : ''}`}>
      {!compact && <div className="field reference-label">参考图 <span>可选 · 数量不限 · 合计不超过 32MB</span></div>}
      <div className="reference-row">
        {value.map((image) => (
          <div className="reference-thumb" key={image.id} title={image.name}>
            <img src={image.dataURL} alt={image.name} />
            <button
              type="button"
              aria-label={`移除参考图 ${image.name}`}
              disabled={disabled}
              onClick={() => onChange(value.filter((item) => item.id !== image.id))}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="reference-add"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          ＋ {compact ? `参考图 ${value.length}` : '添加参考图'}
        </button>
        {canvas && <button type="button" className="reference-add" disabled={disabled} onClick={() => setShowCanvas(!showCanvas)}>从画布选择</button>}
      </div>
      {showCanvas && <div className="reference-row" aria-label="画布图片列表">{canvasImages.length ? canvasImages.map(element => {
        if (element.type !== 'image' || !element.fileId) return null;
        const file = canvas?.getFiles()[element.fileId];
        return file ? <button type="button" className="reference-thumb" key={element.id} onClick={() => addCanvasImage(element)} aria-label={`选择画布图片 ${element.id.slice(0,8)}`}><img src={file.dataURL} alt="画布图片" /></button> : null;
      }) : <span>画布上暂无图片</span>}</div>}
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        disabled={disabled}
        onChange={(event) => void addFiles(event.target.files)}
      />
      {error && <div className="reference-error" role="alert">{error}</div>}
    </div>
  );
}
