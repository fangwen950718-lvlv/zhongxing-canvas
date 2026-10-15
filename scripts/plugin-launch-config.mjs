import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Keep the launch descriptor compatible with Codex's strict stdio parser.
// Presentation metadata belongs in plugin.json, not in the MCP server entry.
export async function pluginLaunchConfig(root) {
  const portable = JSON.parse(await readFile(path.join(root, 'mcp.json'), 'utf8'));
  const legacy = JSON.parse(await readFile(path.join(root, '.mcp.json'), 'utf8'));
  if (JSON.stringify(portable) !== JSON.stringify(legacy)) throw new Error('MCP manifests differ');
  const server = portable.mcpServers?.zhongxing_canvas;
  if (!server || server.type !== 'stdio') throw new Error('Expected zhongxing_canvas stdio server');
  for (const key of Object.keys(server)) {
    if (!['type', 'command', 'args', 'env', 'cwd'].includes(key)) throw new Error(`Unsupported MCP field: ${key}`);
  }
  if (server.command !== 'node' || server.cwd !== '${PLUGIN_ROOT}' || JSON.stringify(server.args) !== JSON.stringify(['${PLUGIN_ROOT}/scripts/start-mcp.mjs'])) throw new Error('MCP launch must use portable plugin-root paths');
  const expand = value => value.replaceAll('${PLUGIN_ROOT}', path.resolve(root));
  return { command: server.command, args: server.args.map(expand), cwd: expand(server.cwd) };
}
