import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runCodexBrief } from './brief-codex-runner.mjs';

export const projectRoot = resolve(process.env.ZHONGXING_CANVAS_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..'));
export const runtime = process.env.ZHONGXING_TEST_RUNTIME || join(projectRoot, 'runtime');
const idPattern = /^[a-f0-9-]{36}$/;
function jobPath(id) { if (!idPattern.test(id)) throw new Error('无效任务编号'); return join(runtime, 'brief-jobs', `${id}.json`); }
async function persist(job) { await mkdir(join(runtime, 'brief-jobs'), { recursive: true }); const file = jobPath(job.id), temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(job, null, 2), { mode: 0o600 }); await rename(temp, file); return job; }
const activeAutomation = new Map();
export async function createBriefJob({ brief, rulePreset = 'social-poster', ruleLabel = '社媒海报', ruleText = '' }) { if (typeof brief !== 'string' || !brief.trim() || brief.length > 30000) throw new Error('请输入生图 brief。'); if (typeof rulePreset !== 'string' || rulePreset.length > 100 || typeof ruleLabel !== 'string' || !ruleLabel.trim() || ruleLabel.length > 200 || typeof ruleText !== 'string' || !ruleText.trim() || ruleText.length > 120000) throw new Error('审美规则库数据无效。'); return persist({ id: randomUUID(), brief: brief.trim(), rulePreset, ruleLabel: ruleLabel.trim(), ruleText: ruleText.trim(), status: 'queued', createdAt: new Date().toISOString() }); }
export async function readBriefJob(id) { return JSON.parse(await readFile(jobPath(id), 'utf8')); }
export async function setBriefJobState(id, status, message) { const job = await readBriefJob(id); if (!['running', 'failed'].includes(status)) throw new Error('无效状态'); if (job.status === 'completed') throw new Error('已完成任务不可重复执行'); return persist({ ...job, status, message: message?.slice(0, 500), updatedAt: new Date().toISOString() }); }
export async function setBriefJobProgress(id, { progress, message, detail, threadId }) { const job = await readBriefJob(id); if (job.status === 'completed' || job.status === 'failed') return job; const events = [...(job.progressEvents || [])]; if (detail && events.at(-1)?.text !== detail) events.push({ at: new Date().toISOString(), text: detail }); return persist({ ...job, status: 'running', progress: Math.max(job.progress || 0, Math.min(99, progress || 0)), message: message?.slice(0, 500) || job.message, codexThreadId: threadId || job.codexThreadId, progressEvents: events.slice(-5), updatedAt: new Date().toISOString() }); }
function validSections(sections) { return sections === undefined || Array.isArray(sections) && sections.length <= 10 && sections.every((section) => section && typeof section.label === 'string' && section.label.trim() && section.label.length <= 40 && typeof section.content === 'string' && section.content.trim() && section.content.length <= 5000); }
function validOptions(options) { return Array.isArray(options) && options.length === 3 && options.every((option) => option && typeof option.title === 'string' && option.title.trim() && option.title.length <= 120 && typeof option.proposal === 'string' && option.proposal.trim() && option.proposal.length <= 30000 && validSections(option.sections) && typeof option.imagePrompt === 'string' && option.imagePrompt.trim() && option.imagePrompt.length <= 30000); }
export async function completeBriefJob(id, optionsOrProposal, imagePrompt) { const job = await readBriefJob(id); if (job.status === 'completed') throw new Error('该任务已完成，不覆盖原结果'); const options = Array.isArray(optionsOrProposal) ? optionsOrProposal : [{ title: '方案', proposal: optionsOrProposal, imagePrompt }]; if (options.length === 1) { const option = options[0]; if (!option || typeof option.proposal !== 'string' || !option.proposal.trim() || typeof option.imagePrompt !== 'string' || !option.imagePrompt.trim()) throw new Error('方案或提示词无效'); return persist({ ...job, status: 'completed', proposal: option.proposal.trim(), imagePrompt: option.imagePrompt.trim(), options: [{ title: option.title || '方案', proposal: option.proposal.trim(), sections: validSections(option.sections) ? option.sections : undefined, imagePrompt: option.imagePrompt.trim() }], updatedAt: new Date().toISOString() }); } if (!validOptions(options)) throw new Error('三组方案或提示词无效'); const normalized = options.map((option) => ({ title: option.title.trim(), proposal: option.proposal.trim(), sections: option.sections?.map((section) => ({ label: section.label.trim(), content: section.content.trim() })), imagePrompt: option.imagePrompt.trim() })); return persist({ ...job, status: 'completed', proposal: normalized[0].proposal, imagePrompt: normalized[0].imagePrompt, options: normalized, updatedAt: new Date().toISOString() }); }

export function startBriefAutomation(job) {
  if (activeAutomation.has(job.id)) return activeAutomation.get(job.id);
  const work = (async () => {
    try {
      await setBriefJobProgress(job.id, { progress: 5, message: '正在启动 Codex 方案任务' });
      const result = await runCodexBrief({ id: job.id, brief: job.brief, ruleLabel: job.ruleLabel, ruleText: job.ruleText, projectRoot, runtime, onProgress: (progress) => setBriefJobProgress(job.id, progress) });
      return await completeBriefJob(job.id, result.options);
    } catch (error) {
      return setBriefJobState(job.id, 'failed', error instanceof Error ? error.message : 'Codex 方案任务失败');
    } finally {
      activeAutomation.delete(job.id);
    }
  })();
  activeAutomation.set(job.id, work);
  return work;
}

export function briefJobsPlugin() {
  const middleware = (req, res, next) => { if (!req.url?.startsWith('/api/brief-jobs')) return next(); void (async () => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const allowedHosts = new Set(['127.0.0.1:4317']), allowed = `http://${req.headers.host}`; if (!allowedHosts.has(req.headers.host) || (req.headers.origin && req.headers.origin !== allowed) || req.headers['sec-fetch-site'] === 'cross-site') { res.statusCode = 403; res.end(JSON.stringify({ error: '只允许本机画布访问' })); return; }
    try { const path = req.url.split('?')[0]; if (req.method === 'POST' && path === '/api/brief-jobs') { if (req.headers['x-zhongxing-canvas'] !== '1') throw new Error('缺少本机请求标识'); let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 350000) throw new Error('请求过大'); } const job = await createBriefJob(JSON.parse(body)); res.end(JSON.stringify(job)); }
      else if (req.method === 'GET' && path.startsWith('/api/brief-jobs/')) res.end(JSON.stringify(await readBriefJob(path.slice('/api/brief-jobs/'.length))));
      else { res.statusCode = 404; res.end(JSON.stringify({ error: '接口不存在' })); }
    } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message || '任务读取失败' })); }
  })(); };
  return { name: 'zhongxing-local-brief-jobs', configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, id, ...rest] = process.argv.slice(2);
  try {
    let result;
    if (action === 'read') result = await readBriefJob(id);
    else if (action === 'start') result = await setBriefJobState(id, 'running');
    else if (action === 'fail') result = await setBriefJobState(id, 'failed', rest.join(' ') || '方案生成未完成');
    else if (action === 'complete') result = await completeBriefJob(id, rest[0], rest[1]);
    else if (action === 'auto') result = await startBriefAutomation(await readBriefJob(id));
    else throw new Error('用法：node scripts/brief-jobs.mjs read|start|fail TASK_ID；complete 请由技能脚本调用导出函数。');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
