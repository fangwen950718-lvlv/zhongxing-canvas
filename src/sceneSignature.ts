// Compare binary data without serializing base64 on every pointer movement.
export function createSceneSignature() {
  let previous:Record<string,{dataURL:string;mimeType:string;created:number;lastRetrieved?:number}>={}, revision=0;
  return (elements:unknown,appState:unknown,files:typeof previous)=>{
    const keys=Object.keys(files);
    if(keys.length!==Object.keys(previous).length||keys.some(id=>{const a=files[id],b=previous[id];return !b||a.dataURL!==b.dataURL||a.mimeType!==b.mimeType||a.created!==b.created||a.lastRetrieved!==b.lastRetrieved;})) {
      previous=Object.fromEntries(keys.map(id=>[id,{...files[id]}]));revision++;
    }
    return JSON.stringify({elements,appState,filesRevision:revision});
  };
}
