import { App } from '@modelcontextprotocol/ext-apps';
import packageInfo from '../package.json';

const shared = window as Window & { __ZHONGXING_MCP_APP__?: Promise<App> };
const app = new App({ name: 'zhongxing-canvas-widget', version: packageInfo.version }, {}, { autoResize: false });
const ready = app.connect().then(() => app);
shared.__ZHONGXING_MCP_APP__ = ready;
ready.catch(() => {});
const cache = new Map<string, Promise<Uint8Array>>();
async function readAsset(id: string): Promise<Uint8Array> {
  if (cache.has(id)) return cache.get(id)!;
  const promise = (async () => {
    const client = await ready;
    const chunks: Uint8Array[] = [];
    let offset = 0, size = 1, sha256 = '';
    while (offset < size) {
      const response = await client.callServerTool({ name: 'read_zhongxing_widget_asset', arguments: { id, offset } });
      if (response.isError) throw new Error(`画布资源读取失败：${id}`);
      const data = response.structuredContent as { base64: string; size: number; sha256: string; offset: number };
      if (!data || data.offset !== offset || !data.base64) throw new Error(`画布资源不完整：${id}`);
      const bytes = Uint8Array.from(atob(data.base64), ch => ch.charCodeAt(0));
      size = data.size; sha256 = data.sha256;
      chunks.push(bytes); offset += bytes.length;
      if (id === 'application.js.gz') {
        const pct = 10 + Math.min(60, Math.round(offset / size * 60));
        document.getElementById('boot-status')!.textContent = `正在加载画布 ${pct}%`;
        (document.getElementById('boot-progress') as HTMLProgressElement).value = pct;
      }
    }
    const result = new Uint8Array(offset);
    let position = 0;
    for (const chunk of chunks) { result.set(chunk, position); position += chunk.length; }
    if (result.length !== size) throw new Error('画布资源长度校验失败');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', result))).map(b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== sha256) throw new Error('画布资源完整性校验失败，请更新插件');
    return result;
  })();
  cache.set(id, promise);
  promise.catch(() => cache.delete(id));
  return promise;
}

async function inflate(id: string) {
  const bytes = await readAsset(id);
  return new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
async function start() {
  try {
    await ready;
    document.getElementById('boot-status')!.textContent = '正在加载画布资源…';
    (document.getElementById('boot-progress') as HTMLProgressElement).value = 10;
    const [js, css] = await Promise.all([inflate('application.js.gz'), inflate('application.css.gz')]);
    const style = document.createElement('style'); style.textContent = css; document.head.append(style);
    document.getElementById('boot-status')!.textContent = '正在启动画布…';
    (document.getElementById('boot-progress') as HTMLProgressElement).value = 75;
    window.addEventListener('zhongxing-data-ready', () => {
      document.getElementById('boot-status')!.textContent = '正在准备画布与控件…';
      (document.getElementById('boot-progress') as HTMLProgressElement).value = 90;
    }, { once: true });
    window.addEventListener('zhongxing-canvas-ready', () => {
      const progress = document.getElementById('boot-progress') as HTMLProgressElement | null;
      if (progress) progress.value = 100;
      document.getElementById('boot')?.remove();
    }, { once: true });
    const url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
    try { await import(/* @vite-ignore */ url); } finally { URL.revokeObjectURL(url); }
  } catch (error) {
    document.getElementById('boot-status')!.textContent = '画布加载未完成';
    document.getElementById('boot-error')!.textContent = `${error instanceof Error ? error.message : error}\n请保留项目数据，重试或将错误发给维护者。`;
    document.getElementById('boot-retry')!.hidden = false;
  }
}
document.getElementById('boot-retry')!.onclick = () => { location.reload(); };
void start();
