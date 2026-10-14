import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJsonResponse } from '../src/codexBridge';

test('Codex bridge source has no production localhost relay', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/codexBridge.ts', import.meta.url), 'utf8'));
  assert.doesNotMatch(source, /127\.0\.0\.1:4318|api\/handoffs/);
});

test('bridge reports empty 404 responses as a restartable local-service error', async () => {
  await assert.rejects(
    readJsonResponse(new Response('', { status: 404 }), '视觉方案接口'),
    /HTTP 404.*重新打开众行画布/,
  );
});

test('bridge parses valid JSON and rejects malformed content', async () => {
  assert.deepEqual(
    await readJsonResponse<{ ok: boolean }>(new Response('{"ok":true}'), '测试接口'),
    { ok: true },
  );
  await assert.rejects(
    readJsonResponse(new Response('not json'), '测试接口'),
    /返回格式异常/,
  );
});
