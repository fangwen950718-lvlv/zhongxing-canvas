import { PNG } from 'pngjs';
import {resampleLanczos} from './resample.mjs';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function validateDimensions(width, height) {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 8192) || width * height > 32_000_000) {
    throw new Error('尺寸需为 1–8192 的整数像素，且总像素不超过 3200 万');
  }
}
export function decodePNG(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) throw new Error('此操作需回填真实 PNG 图片');
  validateDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  return PNG.sync.read(bytes, { checkCRC: true });
}
export function normalizeImageOutput(job, bytes) {
  const input = decodePNG(bytes);
  if (job.kind === 'relayout'||job.kind==='upscale') {
    if (Math.abs(input.width * job.height - input.height * job.width) > Math.max(job.width, job.height)) {
      throw new Error(`生成比例不符：得到 ${input.width}×${input.height}，需要 ${job.width}×${job.height}，请按目标比例重新生成`);
    }
  }
  if(job.kind==='upscale'&&job.upscaleMode==='whole-resample'){
    if(Math.max(input.width,input.height)<Math.min(768,Math.max(job.width,job.height)))throw new Error('整图重绘输出过小，请提供模型原生完整图片，不能回填缩略图');
    return input.width===job.width&&input.height===job.height?bytes:resampleLanczos(input,job.width,job.height);
  }
  if(job.kind==='upscale'&&(input.width<job.width||input.height<job.height))throw new Error(`高清重绘分辨率不足：得到 ${input.width}×${input.height}，需要 ${job.width}×${job.height}；不会用插值放大冒充完成。`);
  if (job.kind === 'remove-background') {
    let transparent = false, foreground = false;
    for (let i = 3; i < input.data.length; i += 4) {
      transparent ||= input.data[i] === 0;
      foreground ||= input.data[i] > 0;
    }
    if (!transparent || !foreground) throw new Error('去背结果需要真实透明背景和有效主体，不能是白底、棋盘格底或全透明空图');
    // Cutouts may be tightly cropped. Preserve the actual output bytes and
    // aspect ratio; never regenerate or resize merely to match the source.
    return bytes;
  }
  if (input.width === job.width && input.height === job.height) return bytes;
  // Aspect ratio has already been checked. Resample with premultiplied alpha;
  // never crop, stretch a mismatched ratio, or invent a replacement image.
  const output = new PNG({ width: job.width, height: job.height });
  for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
    const sx = Math.max(0, Math.min(input.width - 1, (x + .5) * input.width / output.width - .5));
    const sy = Math.max(0, Math.min(input.height - 1, (y + .5) * input.height / output.height - .5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    const samples = [[x0,y0,(1-fx)*(1-fy)],[Math.min(x0+1,input.width-1),y0,fx*(1-fy)],[x0,Math.min(y0+1,input.height-1),(1-fx)*fy],[Math.min(x0+1,input.width-1),Math.min(y0+1,input.height-1),fx*fy]];
    let alpha = 0; const rgb = [0,0,0];
    for (const [px,py,weight] of samples) {
      const at = (py*input.width+px)*4, a = input.data[at+3]/255;
      alpha += a*weight;
      for(let c=0;c<3;c++) rgb[c] += input.data[at+c]*a*weight;
    }
    const at = (y*output.width+x)*4;
    for(let c=0;c<3;c++) output.data[at+c] = alpha ? Math.round(rgb[c]/alpha) : 0;
    output.data[at+3] = Math.round(alpha*255);
  }
  return PNG.sync.write(output);
}
