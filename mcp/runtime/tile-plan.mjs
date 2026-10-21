export const TILE_CORE=896, TILE_OVERLAP=48, TILE_SIZE=992, MAX_TILES=16;
export function planUpscaleTiles(width,height) {
  if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=8192)||width*height>9_000_000)throw new Error('分块实验版总像素上限 900 万，最大边 8192px；请降低倍率。');
  const columns=Math.ceil(width/TILE_CORE),rows=Math.ceil(height/TILE_CORE);
  if(columns*rows>MAX_TILES)throw new Error(`预计 ${columns*rows} 块，超过实验版 ${MAX_TILES} 块上限，请降低倍率。`);
  return Array.from({length:columns*rows},(_,index)=>{const x=index%columns*TILE_CORE,y=Math.floor(index/columns)*TILE_CORE;return {index,x,y,width:Math.min(TILE_CORE,width-x),height:Math.min(TILE_CORE,height-y),inputX:x-TILE_OVERLAP,inputY:y-TILE_OVERLAP,inputSize:TILE_SIZE,status:'queued',attempts:0};});
}
