import {Worker} from 'node:worker_threads';
let busy=false;
export async function runTextureUpscale(bytes,width,height){
  if(busy)throw new Error('已有本地高清任务正在处理，请完成后再试');busy=true;
  try{return await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./texture-worker.mjs',import.meta.url),{workerData:{bytes,width,height}});
    const timer=setTimeout(()=>{void worker.terminate();reject(new Error('本地放大超时，原图未修改，请降低倍率'));},120000);
    worker.once('message',result=>{clearTimeout(timer);void worker.terminate();result.error?reject(new Error(result.error)):resolve({...result,bytes:Buffer.from(result.bytes)});});
    worker.once('error',error=>{clearTimeout(timer);reject(error);});
    worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(new Error('本地高清处理进程已退出，原图未修改'));});
  });}finally{busy=false;}
}
