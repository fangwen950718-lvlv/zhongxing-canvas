import { spawn } from 'node:child_process';

const timeoutMs = 600_000;

export function progressFromCodexEvent(event) {
  if (event?.type === 'thread.started') {
    return { progress: 8, message: 'Codex 已接收任务', threadId: event.thread_id };
  }
  const item = event?.item;
  if (!item) return null;
  if (item.type === 'command_execution') {
    const command = item.command || '';
    if (command.includes('image-jobs.mjs start')) return { progress: 24, message: '任务已读取，正在准备生图' };
    if (command.includes('image-jobs.mjs complete')) return { progress: 90, message: '图片已生成，正在回填画布' };
  }
  if (item.type === 'agent_message' && item.text) {
    const text = item.text.replace(/\s+/g, ' ').trim().slice(0, 260);
    if (/图片已.*生成|真实生成/.test(text)) return { progress: 78, message: '内置模型已生成图片，正在保存', detail: text };
    if (/生图正在执行|正在生成|调用内置/.test(text)) return { progress: 48, message: 'Codex 内置模型正在生成图片', detail: text };
    if (/读取|确认|任务状态/.test(text)) return { progress: 18, message: 'Codex 正在读取任务与画面要求', detail: text };
    return { progress: 32, message: 'Codex 正在处理任务', detail: text };
  }
  if (event?.type === 'turn.completed') return { progress: 96, message: 'Codex 已完成，正在确认回填' };
  return null;
}

function promptFor(job) {
  const skill = job.kind === 'edit' ? '$zhongxing-canvas-image-edit' : '$zhongxing-canvas-image-gen';
  const referenceHint = job.referencePaths?.length
    ? `任务包含 ${job.referencePaths.length} 张用户参考图；必须实际查看并将其作为造型、材质、风格或构图参考，但以任务文字和目标尺寸为最终约束。`
    : '任务没有额外参考图。';
  return `处理众行画布${job.kind === 'edit' ? '图片修改' : '生图'}任务 ${job.id}。严格使用已安装的 ${skill} 和 $imagegen 技能，读取任务数据。${referenceHint} 调用 Codex 内置 image_gen 工具生成真实图片，并完成回填。不要使用需要 OPENAI_API_KEY 的 CLI/API 回退。完成任务文件和图片文件核验后立即结束，不要打开浏览器或调用 CUA。`;
}

export function attachedImagesForJob(job) {
  return [
    ...(job.kind === 'edit' ? [job.originalPath, job.annotatedPath] : []),
    ...(job.referencePaths || []),
  ].filter(Boolean);
}

export function codexArgsForJob(job, projectRoot) {
  const args = [
    'exec',
    '--approve-for-me',
    '--skip-git-repo-check',
    '--ignore-rules',
    '-C',
    projectRoot,
    '--json',
  ];
  for (const imagePath of attachedImagesForJob(job)) args.push('--image', imagePath);
  // --image accepts multiple values, so an explicit option terminator keeps the prompt positional.
  args.push('--', promptFor(job));
  return args;
}

export async function runCodexImage({ job, projectRoot, onProgress }) {
  const args = codexArgsForJob(job, projectRoot);
  await new Promise((resolve, reject) => {
    const child = spawn(process.env.ZHONGXING_CODEX_BIN || 'codex', args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let progressQueue = Promise.resolve();
    const consume = (line) => {
      if (!line.trim()) return;
      try {
        const progress = progressFromCodexEvent(JSON.parse(line));
        if (progress) progressQueue = progressQueue.then(() => onProgress(progress));
      } catch {
        // Codex may emit non-JSON warnings before JSONL starts.
      }
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Codex 生图超过 10 分钟，请重试。'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      const lines = stdout.split('\n');
      stdout = lines.pop() || '';
      lines.forEach(consume);
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 12000) stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      consume(stdout);
      await progressQueue;
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().slice(-1600) || `Codex 生图退出码 ${code}`));
    });
  });
}
