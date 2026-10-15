import { App as McpApp } from '@modelcontextprotocol/ext-apps';
import packageInfo from '../package.json';
import type { ImageJob } from './ImageGenerator';
import type { ReferenceImageInput } from './ReferenceImagePicker';

export interface BriefJob {
  id: string;
  brief: string;
  status: string;
  proposal?: string;
  imagePrompt?: string;
  options?: CreativeOption[];
  message?: string;
  handoffQueued?: boolean;
  automationStarted?: boolean;
  progress?: number;
  codexThreadId?: string;
  progressEvents?: Array<{ at: string; text: string }>;
}
export interface CreativeOption {
  title: string;
  proposal: string;
  sections?: Array<{ label: string; content: string }>;
  imagePrompt: string;
}

declare global {
  interface Window {
    openai?: {
      callTool?: (name: string, input: Record<string, unknown>) => Promise<unknown>;
      sendFollowUpMessage?: (input: {
        prompt: string;
        scrollToBottom?: boolean;
      }) => Promise<unknown>;
      requestDisplayMode?: (input: {
        mode: 'inline' | 'pip' | 'fullscreen';
      }) => Promise<unknown>;
      displayMode?: 'inline' | 'pip' | 'fullscreen';
    };
  }
}

let appPromise: Promise<McpApp | null> | null = null;

export async function requestCanvasFullscreen() {
  const app = await getMcpApp();
  if (app) {
    try { await app.requestDisplayMode({ mode: 'fullscreen' }, { timeout: 5000 }); return true; }
    catch (error) { console.warn('Host did not grant fullscreen.', error); }
  }
  if (window.openai?.displayMode === 'fullscreen') return true;
  if (typeof window.openai?.requestDisplayMode !== 'function') return false;
  try {
    await window.openai.requestDisplayMode({ mode: 'fullscreen' });
    return true;
  } catch (error) {
    console.warn('Codex fullscreen canvas request was declined.', error);
    return false;
  }
}

async function getMcpApp() {
  if (window.parent === window) return null;
  const shared = window as Window & { __ZHONGXING_MCP_APP__?: Promise<McpApp> };
  if (shared.__ZHONGXING_MCP_APP__) return shared.__ZHONGXING_MCP_APP__;
  if (!appPromise) {
    appPromise = (async () => {
      try {
        const app = new McpApp(
          { name: 'zhongxing-canvas-widget', version: packageInfo.version },
          {},
          { autoResize: false },
        );
        await app.connect();
        return app;
      } catch (error) {
        console.warn('MCP Apps bridge unavailable; using compatibility fallback.', error);
        return null;
      }
    })();
  }
  return appPromise;
}

export async function callTool(name: string, input: Record<string, unknown>) {
  const app = await getMcpApp();
  if (app?.getHostCapabilities()?.serverTools) {
    const result = await app.callServerTool({ name, arguments: input });
    if (result.isError) {
      const message = result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n');
      throw new Error(message || 'Codex 插件工具执行失败。');
    }
    return result;
  }
  if (typeof window.openai?.callTool === 'function') {
    return window.openai.callTool(name, input);
  }
  return null;
}

export async function sendCodexMessage(prompt: string) {
  const app = await getMcpApp();
  if (app) {
    try {
      // Some Codex hosts implement ui/message before advertising the optional
      // capability. Try the standard request instead of failing on that flag.
      const result = await app.sendMessage(
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        },
        { timeout: 8000 },
      );
      if (!result.isError) return true;
    } catch (error) {
      console.warn('MCP Apps message bridge unavailable; trying compatibility bridge.', error);
    }
  }
  if (typeof window.openai?.sendFollowUpMessage === 'function') {
    try {
      await window.openai.sendFollowUpMessage({ prompt, scrollToBottom: true });
      return true;
    } catch (error) {
      console.warn('Codex compatibility message bridge unavailable.', error);
    }
  }
  return false;
}

function toolJob(result: unknown): ImageJob {
  const value = result as {
    structuredContent?: { job?: ImageJob } & Partial<ImageJob>;
  };
  const job = value?.structuredContent?.job || value?.structuredContent;
  if (!job || typeof job.id !== 'string') {
    throw new Error('Codex 插件没有返回有效的生图任务。');
  }
  return job as ImageJob;
}

export async function readJsonResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(
      response.ok
        ? `${label}返回了空响应，请重新打开众行画布。`
        : `${label}不可用（HTTP ${response.status}），请重新打开众行画布。`,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label}返回格式异常，请重新打开众行画布。`);
  }
}

export async function createImageJob(
  prompt: string,
  ratio: string,
  referenceImages: ReferenceImageInput[] = [],
) {
  const references = referenceImages.map(({ name, dataURL }) => ({ name, dataURL }));
  const result = await callTool('create_zhongxing_image_job', { prompt, ratio, referenceImages: references });
  if (result) return toolJob(result);

  const response = await fetch('/api/image-jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Zhongxing-Canvas': '1',
    },
    body: JSON.stringify({ prompt, ratio, referenceImages: references }),
  });
  const data = await readJsonResponse<ImageJob & { error?: string }>(response, '生图任务接口');
  if (!response.ok) throw new Error(data.error);
  return data as ImageJob;
}

export async function getImageJob(id: string) {
  const result = await callTool('get_zhongxing_image_job', { id });
  if (result) return toolJob(result);

  const response = await fetch(`/api/image-jobs/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error('任务暂不可读');
  return readJsonResponse<ImageJob>(response, '生图任务接口');
}

export async function createImageEditJob(input: {
  prompt: string;
  ratio: string;
  width: number;
  height: number;
  originalDataURL: string;
  annotatedDataURL: string;
  referenceImages?: ReferenceImageInput[];
}) {
  const payload = {
    ...input,
    referenceImages: (input.referenceImages || []).map(({ name, dataURL }) => ({ name, dataURL })),
  };
  const result = await callTool('create_zhongxing_image_edit_job', payload);
  if (result) return toolJob(result);
  const response = await fetch('/api/image-jobs/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Zhongxing-Canvas': '1' },
    body: JSON.stringify(payload),
  });
  const data = await readJsonResponse<ImageJob & { error?: string }>(response, '图片修改接口');
  if (!response.ok) throw new Error(data.error);
  return data as ImageJob;
}

function toolBriefJob(result: unknown): BriefJob {
  const value = result as { structuredContent?: { job?: BriefJob } & Partial<BriefJob> };
  const job = value?.structuredContent?.job || value?.structuredContent;
  if (!job || typeof job.id !== 'string') throw new Error('Codex 插件没有返回有效的方案任务。');
  return job as BriefJob;
}

export async function createBriefJob(input: {
  brief: string;
  rulePreset: string;
  ruleLabel: string;
  ruleText: string;
}) {
  const result = await callTool('create_zhongxing_brief_job', input);
  if (result) return toolBriefJob(result);
  const response = await fetch('/api/brief-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Zhongxing-Canvas': '1' },
    body: JSON.stringify(input),
  });
  const data = await readJsonResponse<BriefJob & { error?: string }>(response, '视觉方案接口');
  if (!response.ok) throw new Error(data.error);
  return data as BriefJob;
}

export async function getBriefJob(id: string) {
  const result = await callTool('get_zhongxing_brief_job', { id });
  if (result) return toolBriefJob(result);
  const response = await fetch(`/api/brief-jobs/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error('方案任务暂不可读');
  return readJsonResponse<BriefJob>(response, '视觉方案接口');
}
