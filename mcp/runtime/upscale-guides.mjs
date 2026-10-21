import {PNG} from 'pngjs';
import {decodePNG} from './image-output.mjs';

// Analyse at a coarse scale first. Raw full-resolution Sobel edges also
// reproduce worm-like texture defects, so they must not be used as structure.
export function makeUpscaleGuides(bytes) {
  const input=decodePNG(bytes),scale=Math.min(1,1024/Math.max(input.width,input.height));
  const width=Math.max(1,Math.round(input.width*scale)),height=Math.max(1,Math.round(input.height*scale));
  const analysisScale=Math.min(1,192/Math.max(input.width,input.height));
  const aw=Math.max(1,Math.round(input.width*analysisScale)),ah=Math.max(1,Math.round(input.height*analysisScale));
  let values=new Float64Array(aw*ah*3);
  // Area averaging suppresses small high-frequency marks instead of aliasing them.
  for(let y=0;y<ah;y++)for(let x=0;x<aw;x++){
    let count=0;const target=(y*aw+x)*3;
    for(let sy=Math.floor(y*input.height/ah);sy<Math.max(Math.floor(y*input.height/ah)+1,Math.floor((y+1)*input.height/ah));sy++)for(let sx=Math.floor(x*input.width/aw);sx<Math.max(Math.floor(x*input.width/aw)+1,Math.floor((x+1)*input.width/aw));sx++){
      const at=(sy*input.width+sx)*4,a=input.data[at+3]/255;for(let c=0;c<3;c++)values[target+c]+=input.data[at+c]*a+255*(1-a);count++;
    }
    for(let c=0;c<3;c++)values[target+c]/=count;
  }
  for(let pass=0;pass<2;pass++){
    const smooth=new Float64Array(values.length);
    for(let y=0;y<ah;y++)for(let x=0;x<aw;x++)for(let c=0;c<3;c++){
      let sum=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)sum+=values[(Math.max(0,Math.min(ah-1,y+dy))*aw+Math.max(0,Math.min(aw-1,x+dx)))*3+c];
      smooth[(y*aw+x)*3+c]=sum/9;
    }
    values=smooth;
  }
  const luminance=new Float64Array(aw*ah);
  for(let i=0;i<luminance.length;i++)luminance[i]=values[i*3]*.2126+values[i*3+1]*.7152+values[i*3+2]*.0722;
  const edges=new Uint8Array(aw*ah);
  const read=(x,y)=>luminance[Math.max(0,Math.min(ah-1,y))*aw+Math.max(0,Math.min(aw-1,x))];
  for(let y=0;y<ah;y++)for(let x=0;x<aw;x++){
    const gx=-read(x-1,y-1)+read(x+1,y-1)-2*read(x-1,y)+2*read(x+1,y)-read(x-1,y+1)+read(x+1,y+1);
    const gy=-read(x-1,y-1)-2*read(x,y-1)-read(x+1,y-1)+read(x-1,y+1)+2*read(x,y+1)+read(x+1,y+1);
    edges[y*aw+x]=Math.hypot(gx,gy)/4>24?40:255;
  }
  const color=new PNG({width,height}),gray=new PNG({width,height}),line=new PNG({width,height});
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,s=Math.min(ah-1,Math.floor(y*ah/height))*aw+Math.min(aw-1,Math.floor(x*aw/width));
    for(let c=0;c<3;c++)color.data[i+c]=Math.min(255,Math.round(values[s*3+c]/16)*16);
    const l=Math.round(luminance[s]/8)*8;
    gray.data[i]=gray.data[i+1]=gray.data[i+2]=Math.min(255,l);gray.data[i+3]=color.data[i+3]=255;
    line.data[i]=line.data[i+1]=line.data[i+2]=edges[s];line.data[i+3]=255;
  }
  return {line:PNG.sync.write(line),color:PNG.sync.write(color),gray:PNG.sync.write(gray)};
}
