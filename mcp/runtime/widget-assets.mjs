import { readFile, open } from 'node:fs/promises';
import { join } from 'node:path';
export const ASSET_CHUNK_BYTES = 96 * 1024;
export async function readWidgetAsset(directory, id, offset = 0) {
  const manifest = JSON.parse(await readFile(join(directory, 'asset-manifest.json'), 'utf8'));
  if (!Object.hasOwn(manifest, id)) throw new Error('Unknown bundled asset');
  const item = manifest[id];
  if (item.file !== id || id.split(/[\\/]/).some(part => part === '..') || id.startsWith('/') || id.includes(':')) throw new Error('Invalid bundled asset path');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= item.bytes) throw new Error('Invalid asset offset');
  const file = await open(join(directory, 'assets', item.file), 'r');
  try {
    if ((await file.stat()).size !== item.bytes) throw new Error('Bundled asset length mismatch');
    const bytes = Buffer.alloc(Math.min(ASSET_CHUNK_BYTES, item.bytes - offset));
    const { bytesRead } = await file.read(bytes, 0, bytes.length, offset);
    if (bytesRead !== bytes.length) throw new Error('Incomplete asset chunk');
    return { base64: bytes.toString('base64'), offset, size: item.bytes, sha256: item.sha256, mimeType: item.mimeType, encoding: item.encoding };
  } finally { await file.close(); }
}
