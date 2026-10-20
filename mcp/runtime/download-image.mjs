import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, parse } from 'node:path';

export async function downloadOriginalImage(dataURL, filename, directory=process.env.ZHONGXING_CANVAS_DOWNLOAD_DIR||join(homedir(),'Downloads')) {
  const match=typeof dataURL==='string'&&dataURL.match(/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml|avif));base64,([A-Za-z0-9+/]*={0,2})$/);
  if(!match)throw new Error('原图数据格式无效');
  const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>25*1024*1024)throw new Error('原图为空或超过 25MB');
  const ext={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','image/svg+xml':'.svg','image/avif':'.avif'}[match[1]];
  const safe=String(filename).replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,120);
  const name=parse(safe).name.replace(/^\.+/,'')||'众行原图';
  await mkdir(directory,{recursive:true});
  for(let i=0;i<1000;i++) {
    const file=join(directory,`${name}${i?` (${i+1})`:''}${ext}`);
    try{await writeFile(file,bytes,{flag:'wx',mode:0o600});return {savedPath:file,bytes:bytes.length};}
    catch(error){if(error.code!=='EEXIST')throw error;}
  }
  throw new Error('同名文件过多，请修改项目名后重试');
}
