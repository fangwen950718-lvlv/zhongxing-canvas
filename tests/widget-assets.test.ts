import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readWidgetAsset, ASSET_CHUNK_BYTES } from '../mcp/runtime/widget-assets.mjs';

test('widget transfer is bounded, complete and confined to manifest assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zhongxing-assets-'));
  await mkdir(join(dir, 'assets'));
  const bytes = Buffer.alloc(ASSET_CHUNK_BYTES * 2 + 7, 123);
  await writeFile(join(dir, 'assets/test.gz'), bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(dir, 'asset-manifest.json'), JSON.stringify({ 'test.gz': { file: 'test.gz', bytes: bytes.length, sha256, mimeType: 'text/javascript', encoding: 'gzip' } }));
  const chunks = [];
  for (let offset = 0; offset < bytes.length;) {
    const result = await readWidgetAsset(dir, 'test.gz', offset);
    const chunk = Buffer.from(result.base64, 'base64');
    assert(chunk.length <= ASSET_CHUNK_BYTES);
    assert.equal(result.offset, offset); assert.equal(result.sha256, sha256);
    chunks.push(chunk); offset += chunk.length;
  }
  assert.deepEqual(Buffer.concat(chunks), bytes);
  for (const id of ['../package.json', '/etc/passwd', '__proto__', 'unknown']) await assert.rejects(readWidgetAsset(dir, id));
  for (const offset of [-1, 0.5, bytes.length]) await assert.rejects(readWidgetAsset(dir, 'test.gz', offset));
});

test('release widget entry stays below 250 KB, with local payloads outside HTML', async () => {
  const html = await readFile('mcp/generated/zhongxing-canvas-widget.html', 'utf8');
  assert(Buffer.byteLength(html) <= 250_000);
  const manifest = JSON.parse(await readFile('mcp/generated/asset-manifest.json', 'utf8'));
  assert(manifest['application.js.gz']); assert(manifest['application.css.gz']);
});
