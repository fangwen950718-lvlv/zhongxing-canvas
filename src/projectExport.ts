// Avoid rendering or stringifying a large base64 JSON document on the UI thread.
export function projectBlobInWorker(project:unknown):Promise<Blob>{
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(new Blob([`self.onmessage=({data})=>{try{self.postMessage({blob:new Blob([JSON.stringify(data)],{type:'application/json'})})}catch(e){self.postMessage({error:e.message})}}`],{type:'text/javascript'}));
    let worker:Worker;
    try{worker=new Worker(url);}catch(error){URL.revokeObjectURL(url);reject(error);return;}
    const cleanup=()=>{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);};
    const timer=setTimeout(()=>{cleanup();reject(new Error('项目整理超时，请导出较小项目或在插件内重试'));},60000);
    worker.onmessage=({data})=>{cleanup();data.blob instanceof Blob?resolve(data.blob):reject(new Error(data.error||'项目整理失败'));};
    worker.onerror=()=>{cleanup();reject(new Error('浏览器无法启动后台导出，请在 Codex 插件内导出'));};
    try{worker.postMessage(project);}catch(error){cleanup();reject(error);}
  });
}
