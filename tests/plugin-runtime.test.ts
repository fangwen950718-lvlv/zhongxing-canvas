import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './image-fixture.mjs';

process.env.ZHONGXING_TEST_RUNTIME = await mkdtemp(join(tmpdir(), 'zhongxing-plugin-runtime-'));
const store = await import('../mcp/runtime/job-store.mjs');

test('release runtime stores image and brief jobs outside plugin files', async () => {
  assert.equal(store.runtime, process.env.ZHONGXING_TEST_RUNTIME);
  const image = await store.createImageJob({ prompt: '发布测试', ratio: '16:9' });
  const brief = await store.createBriefJob({ brief: '发布方案测试', ruleLabel: '社媒海报', ruleText: '单一视觉钩子' });
  assert.equal((await store.readImageJob(image.id)).status, 'queued');
  assert.equal((await store.readBriefJob(brief.id)).status, 'queued');
});

test('release runtime completes without overwriting a finished result', async () => {
  const image = await store.createImageJob({ prompt: '完成测试', ratio: '1:1' });
  await store.completeImageJob(image.id, fixture);
  const completed = await store.publicImageJob(image.id);
  assert.match(completed.dataURL, /^data:image\/png;base64,/);
  await assert.rejects(store.completeImageJob(image.id, fixture), /不覆盖/);
  assert.ok((await readFile(join(store.runtime, 'jobs', `${image.id}.json`))).length > 0);
});
