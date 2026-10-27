import {parentPort,workerData} from 'node:worker_threads';
import {texturePreservingUpscale} from './texture-upscale.mjs';
try{const result=texturePreservingUpscale(Buffer.from(workerData.bytes),workerData.width,workerData.height);parentPort.postMessage(result);}
catch(error){parentPort.postMessage({error:error.message});}
