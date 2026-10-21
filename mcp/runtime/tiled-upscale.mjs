import {PNG} from 'pngjs';
import {decodePNG,normalizeImageOutput} from './image-output.mjs';
import {TILE_OVERLAP,TILE_SIZE} from './tile-plan.mjs';

export function tileReference(bytes,scale,tile) {
  const source=decodePNG(bytes),size=TILE_SIZE/scale,crop=new PNG({width:size,height:size});
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const sx=Math.max(0,Math.min(source.width-1,Math.floor(tile.inputX/scale+x))),sy=Math.max(0,Math.min(source.height-1,Math.floor(tile.inputY/scale+y)));
    source.data.copy(crop.data,(y*size+x)*4,(sy*source.width+sx)*4,(sy*source.width+sx)*4+4);
  }
  return PNG.sync.write(crop);
}
export function normalizeTile(bytes) {return normalizeImageOutput({kind:'upscale',width:TILE_SIZE,height:TILE_SIZE},bytes);}
export function tilePrompt(job,tile) {
  return `众行分块高清，第 ${tile.index+1}/${job.tiles.length} 块。第一张图是当前局部裁切，必须只重绘这一块，不能画成原图全景。后续线稿、配色稿、灰度稿约束同一区域；完整原图仅用于理解，不可替代第一张裁切。当前局部对应整图 ${job.width}×${job.height} 的 x=${tile.inputX}, y=${tile.inputY}, ${TILE_SIZE}×${TILE_SIZE} 区域（含边缘重叠）。输出正方形 PNG，实际像素至少 ${TILE_SIZE}×${TILE_SIZE}；不依靠提示词强求整张4K输出。严格保持裁切边界、构图、主体数量位置和颜色、逐字文案、光照，不移动物件，不另做设计，不加字或边框。重建清晰细节、修复蚯蚓纹与融化纹理，避免锐化光晕；参考稿轮廓和分色色块不要画进成品。周围48像素将与邻块混合，保持边缘内容连续。必须调用内置图片工具真实重绘，不以普通插值或复制参考图提交。${job.prompt}`;
}
function weight(position,start,length) {
  if(position<start)return Math.max(0,(position-start+TILE_OVERLAP)/TILE_OVERLAP);
  if(position>=start+length)return Math.max(0,(start+length+TILE_OVERLAP-position)/TILE_OVERLAP);
  return 1;
}
export function stitchTiles(width,height,tiles,images) {
  if(tiles.length!==images.length||!tiles.length)throw new Error('缺少分块结果，不能拼接');
  const decoded=images.map(decodePNG);
  if(decoded.some(img=>img.width!==TILE_SIZE||img.height!==TILE_SIZE))throw new Error('分块尺寸无效');
  const output=new PNG({width,height}),colors=new Float64Array(width*4),weights=new Float64Array(width);
  for(let y=0;y<height;y++){
    colors.fill(0);weights.fill(0);
    tiles.forEach((tile,index)=>{
      const wy=weight(y,tile.y,tile.height);if(wy<=0)return;
      const sy=y-tile.inputY;if(sy<0||sy>=TILE_SIZE)return;
      for(let x=Math.max(0,tile.x-TILE_OVERLAP);x<Math.min(width,tile.x+tile.width+TILE_OVERLAP);x++){
        const w=wy*weight(x,tile.x,tile.width);if(w<=0)continue;
        const source=(sy*TILE_SIZE+x-tile.inputX)*4,a=decoded[index].data[source+3]/255;
        weights[x]+=w;colors[x*4+3]+=a*w;
        for(let c=0;c<3;c++)colors[x*4+c]+=decoded[index].data[source+c]*a*w;
      }
    });
    for(let x=0;x<width;x++){
      if(!weights[x])throw new Error('分块覆盖不完整，不能输出空白区域');
      const at=(y*width+x)*4,a=colors[x*4+3];
      for(let c=0;c<3;c++)output.data[at+c]=a?Math.round(colors[x*4+c]/a):0;
      output.data[at+3]=Math.round(255*a/weights[x]);
    }
  }
  return PNG.sync.write(output);
}
