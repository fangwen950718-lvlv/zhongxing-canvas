import {PNG} from 'pngjs';

function kernel(x){x=Math.abs(x);if(x===0)return 1;if(x>=3)return 0;return 3*Math.sin(Math.PI*x)*Math.sin(Math.PI*x/3)/(Math.PI*Math.PI*x*x);}
function contributions(source,target){
  const scale=source/target,filter=Math.max(1,scale);
  return Array.from({length:target},(_,i)=>{
    const center=(i+.5)*scale-.5,values=new Map();let sum=0;
    for(let p=Math.ceil(center-3*filter);p<=Math.floor(center+3*filter);p++){
      const w=kernel((center-p)/filter);if(!w)continue;
      const at=Math.max(0,Math.min(source-1,p));values.set(at,(values.get(at)||0)+w);sum+=w;
    }
    return [...values].map(([index,weight])=>({index,weight:weight/sum}));
  });
}
// Bounded row cache, premultiplied alpha. This is deterministic Lanczos-3
// resampling of an AI-produced full image, NOT learned super-resolution.
export function resampleLanczos(input,width,height){
  const xs=contributions(input.width,width),ys=contributions(input.height,height),cache=new Map();
  const output=new PNG({width,height});
  for(let y=0;y<height;y++){
    const needed=new Set(ys[y].map(v=>v.index));for(const key of cache.keys())if(!needed.has(key))cache.delete(key);
    for(const sy of needed)if(!cache.has(sy)){
      const row=new Float64Array(width*4);
      for(let x=0;x<width;x++)for(const {index:sx,weight:w} of xs[x]){
        const at=(sy*input.width+sx)*4,a=input.data[at+3]/255;
        row[x*4+3]+=a*w;for(let c=0;c<3;c++)row[x*4+c]+=input.data[at+c]*a*w;
      }
      cache.set(sy,row);
    }
    for(let x=0;x<width;x++){
      const rgba=[0,0,0,0];for(const {index,weight} of ys[y])for(let c=0;c<4;c++)rgba[c]+=cache.get(index)[x*4+c]*weight;
      const at=(y*width+x)*4;for(let c=0;c<3;c++)output.data[at+c]=rgba[3]>1e-8?Math.max(0,Math.min(255,Math.round(rgba[c]/rgba[3]))):0;
      output.data[at+3]=Math.max(0,Math.min(255,Math.round(rgba[3]*255)));
    }
  }
  return PNG.sync.write(output);
}
