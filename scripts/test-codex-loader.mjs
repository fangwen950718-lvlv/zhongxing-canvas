import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

const source = path.resolve(process.argv[2] || 'release/zhongxing-canvas');
const sandbox = await mkdtemp(path.join(tmpdir(), 'zhongxing-codex-loader-'));
const home = path.join(sandbox, 'codex-home');
const market = path.join(sandbox, 'market');
await mkdir(home);
await cp(source, market, { recursive: true });
const pkg = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
const legacyFixture = process.argv.includes('--legacy-fixture');
if (legacyFixture) {
  // Reproduce the member's exact failure without changing the release files.
  const old = JSON.parse(await readFile(path.join(market, 'mcp.json'), 'utf8'));
  old.mcpServers.zhongxing_canvas.title = 'Unsupported metadata';
  old.mcpServers.zhongxing_canvas.description = 'Unsupported metadata';
  for (const file of ['mcp.json', '.mcp.json']) await writeFile(path.join(market, file), JSON.stringify(old));
}
let stderr = '';
const app = spawn(process.env.ZHONGXING_TEST_CODEX || 'codex', ['app-server', '--stdio'], {
  cwd: sandbox,
  env: { ...process.env, CODEX_HOME: home, ZHONGXING_CANVAS_DATA_DIR: path.join(sandbox, 'user-data'), RUST_LOG: 'warn' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
app.stderr.on('data', chunk => { stderr += chunk; });
let seq = 0;
const pending = new Map();
createInterface({ input: app.stdout }).on('line', line => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const call = pending.get(msg.id);
  if (call) { clearTimeout(call.timer); pending.delete(msg.id); msg.error ? call.reject(new Error(JSON.stringify(msg.error))) : call.resolve(msg.result); }
});
function rpc(method, params) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${stderr.slice(-2000)}`)); }, 45000);
    pending.set(id, { resolve, reject, timer });
    app.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
try {
  await rpc('initialize', { clientInfo: { name: 'zhongxing-loader-test', version: pkg.version }, capabilities: { experimentalApi: true } });
  app.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const install = await rpc('plugin/install', { marketplacePath: path.join(market, '.agents/plugins/marketplace.json'), pluginName: 'zhongxing-canvas' });
  console.log('Installed through Codex:', JSON.stringify(install));
  const status = await rpc('mcpServerStatus/list', {});
  await writeFile(path.join(sandbox, 'status.json'), JSON.stringify(status, null, 2));
  const servers = status.data || [];
  const server = servers.find(s => s.name?.includes('zhongxing_canvas'));
  if (legacyFixture) {
    assert(!server, 'Invalid legacy descriptor unexpectedly loaded');
    assert(stderr.includes('unknown field `title`'), `Expected member parse failure: ${stderr}`);
    console.log(JSON.stringify({ ok: true, regressionReproduced: 'unknown field title', sandbox }, null, 2));
  } else {
  assert(server, `Codex did not discover server: ${JSON.stringify(status)} ${stderr.slice(-1500)}`);
  assert(Object.keys(server.tools || {}).some(name => name.includes('open_zhongxing_independent_canvas')), `Codex did not discover open tool: ${JSON.stringify(server)}`);
  assert(!stderr.includes('failed to parse plugin MCP server'), 'Codex parser rejected configuration');
  console.log(JSON.stringify({ ok: true, version: pkg.version, server: server.name, tools: Object.keys(server.tools).length, sandbox, loader: 'actual Codex app-server, isolated CODEX_HOME' }, null, 2));
  }
} finally {
  for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Test ended')); }
  app.stdin.end();
  app.kill();
  await writeFile(path.join(sandbox, 'stderr.log'), stderr);
}
