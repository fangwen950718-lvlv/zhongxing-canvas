import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-ignore Node build tooling shared with release checks
import { pluginLaunchConfig } from '../scripts/plugin-launch-config.mjs';

test('release MCP descriptors use strict Codex-compatible fields and plugin-root paths', async () => {
  const root = path.resolve('.');
  const config = await pluginLaunchConfig(root);
  assert.equal(config.cwd, root);
  assert.deepEqual(config.args, [path.join(root, 'scripts/start-mcp.mjs')]);
});

test('regression: title and description are rejected before publishing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zhongxing-config-'));
  const original = JSON.parse(await readFile('mcp.json', 'utf8'));
  for (const key of ['title', 'description']) {
    const config = structuredClone(original);
    config.mcpServers.zhongxing_canvas[key] = 'unsupported presentation metadata';
    await Promise.all(['mcp.json', '.mcp.json'].map(file => writeFile(path.join(root, file), JSON.stringify(config))));
    await assert.rejects(pluginLaunchConfig(root), new RegExp(`Unsupported MCP field: ${key}`));
  }
});
