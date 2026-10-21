// Coalesce full-project writes during dragging/panning. Explicit export/close
// still flushes immediately; this only gates the periodic background save.
export function createSaveSchedule(){
  let first:number|null=null,last=0,retryAt=0,failures=0;
  return {
    changed(now=Date.now()){first??=now;last=now;},
    ready(now=Date.now()){return first!==null&&now>=retryAt&&(now-last>=1200||now-first>=5000);},
    success(stillDirty:boolean,now=Date.now()){first=stillDirty?now:null;retryAt=0;failures=0;},
    failed(now=Date.now()){failures++;retryAt=now+Math.min(30000,5000*2**(failures-1));},
  };
}
