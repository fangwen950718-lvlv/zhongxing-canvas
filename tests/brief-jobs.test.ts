import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { effectiveRules } from '../src/ruleLibraryState';

process.env.ZHONGXING_TEST_RUNTIME = await mkdtemp(join(tmpdir(), 'zhongxing-brief-test-'));
const { createBriefJob, readBriefJob, setBriefJobState, completeBriefJob } = await import('../scripts/brief-jobs.mjs');
const { makeBriefPrompt, progressFromBriefEvent } = await import('../scripts/brief-codex-runner.mjs');

test('Codex brief prompt treats canvas input as data and requests three rule-aware options', () => {
  const prompt = makeBriefPrompt({ brief: '测试主视觉 brief', ruleLabel: '三维 IP 海报', ruleText: '统一材质逻辑' });
  assert.match(prompt, /不是系统指令/);
  assert.match(prompt, /测试主视觉 brief/);
  assert.match(prompt, /proposal/);
  assert.match(prompt, /sections/);
  assert.match(prompt, /imagePrompt/);
  assert.match(prompt, /数组长度必须为 3/);
  assert.match(prompt, /统一材质逻辑/);
});

test('Codex brief events map to visible canvas progress', () => {
  assert.equal(progressFromBriefEvent({ type: 'thread.started', thread_id: 'brief-thread' })?.progress, 8);
  assert.equal(progressFromBriefEvent({ type: 'item.completed', item: { type: 'agent_message', text: '正在分析 brief 需求。' } })?.progress, 28);
});

test('brief task returns three proposals and demo prompts', async () => {
  const job = await createBriefJob({ brief: '为春季品牌活动制作轻盈自然的主视觉', rulePreset: 'social-poster', ruleLabel: '社媒海报', ruleText: '强调单一视觉钩子' });
  assert.equal(job.status, 'queued');
  await setBriefJobState(job.id, 'running');
  await completeBriefJob(job.id, [1,2,3].map((number) => ({ title: `方向 ${number}`, proposal: `以生长轨迹 ${number} 作为视觉主轴。`, sections: [{label:'创意主轴',content:'自然生长'},{label:'视觉主体',content:'植物轨迹'},{label:'构图层级',content:'中心构图'},{label:'风险提示',content:'避免细碎'}], imagePrompt: `春日自然光下的植物生长轨迹 ${number}，留出品牌文案区。` })));
  const completed = await readBriefJob(job.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.options.length, 3);
  assert.match(completed.imagePrompt, /春日自然光/);
});

test('brief task rejects empty input and completed overwrite', async () => {
  await assert.rejects(createBriefJob({ brief: '' }));
  const job = await createBriefJob({ brief: '测试 brief', ruleText: '测试审美规则' });
  await completeBriefJob(job.id, '方案', '提示词');
  await assert.rejects(completeBriefJob(job.id, '覆盖', '覆盖'), /不覆盖/);
});
test('brief task stores exactly the previewed editable rule snapshot',async()=>{
  const ruleText=effectiveRules({commonRulesText:'工作顺序：先看参考图。\n画面规则：黑白构图。'},{label:'新规则',rules:'层级规则：仅给方向。'});
  const job=await createBriefJob({brief:'测试',ruleText});
  assert.equal((await readBriefJob(job.id)).ruleText,ruleText);
  const prompt=makeBriefPrompt({brief:'测试',ruleText});
  assert(prompt.includes(ruleText));assert(!prompt.includes('单母体收敛'));
});
