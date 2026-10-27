import {PNG} from 'pngjs';
import {decodePNG,validateDimensions} from './image-output.mjs';

// No negative-lobed kernel, no generative redraw, no tile blending, no sharpening.
// Flat-area smoothing is deliberately bounded; existing strong defects may remain.
export function texturePreservingUpscale(bytes,width,height){
  validateDimensions(width,height);
  const source=decodePNG(bytes),factor=width/source.width;
  if(![2,4].includes(factor)||height!==source.height*factor)throw new Error('保真放大仅支持 ×2/×4');
  const clean=Buffer.from(source.data);let changed=0;
  for(let y=1;y<source.height-1;y++)for(let x=1;x<source.width-1;x++){
    const at=(y*source.width+x)*4;if(source.data[at+3]!==255)continue;
    let lo=255,hi=0,sum=[0,0,0],opaque=true;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const n=((y+dy)*source.width+x+dx)*4;
      opaque&&=source.data[n+3]===255;
      const l=.2126*source.data[n]+.7152*source.data[n+1]+.0722*source.data[n+2];lo=Math.min(lo,l);hi=Math.max(hi,l);
      for(let c=0;c<3;c++)sum[c]+=source.data[n+c];
    }
    if(opaque&&hi-lo<=14){for(let c=0;c<3;c++)clean[at+c]=Math.round(source.data[at+c]*.65+sum[c]/9*.35);changed++;}
  }
  const result=new PNG({width,height});
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=Math.max(0,Math.min(source.width-1,(x+.5)/factor-.5)),sy=Math.max(0,Math.min(source.height-1,(y+.5)/factor-.5));
    const x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;
    const samples=[[x0,y0,(1-fx)*(1-fy)],[Math.min(x0+1,source.width-1),y0,fx*(1-fy)],[x0,Math.min(y0+1,source.height-1),(1-fx)*fy],[Math.min(x0+1,source.width-1),Math.min(y0+1,source.height-1),fx*fy]];
    let a=0;const rgb=[0,0,0];for(const [px,py,w] of samples){const n=(py*source.width+px)*4,alpha=clean[n+3]/255;a+=alpha*w;for(let c=0;c<3;c++)rgb[c]+=clean[n+c]*alpha*w;}
    const at=(y*width+x)*4;for(let c=0;c<3;c++)result.data[at+c]=a?Math.round(rgb[c]/a):0;result.data[at+3]=Math.round(a*255);
  }
  return {bytes:PNG.sync.write(result),quality:{method:'flat-area-denoise+bilinear',smoothedPixels:changed,sourceWidth:source.width,sourceHeight:source.height,generated:false,qualityGuaranteed:false}};
}
