import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';

export function getUserDataRoot(env = process.env) {
  if (env.ZHONGXING_CANVAS_DATA_DIR) return resolve(env.ZHONGXING_CANVAS_DATA_DIR);
  if (env.ZHONGXING_TEST_RUNTIME) return resolve(env.ZHONGXING_TEST_RUNTIME);
  if (platform() === 'win32') {
    return join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'zhongxing-canvas');
  }
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'zhongxing-canvas');
  }
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'zhongxing-canvas');
}

