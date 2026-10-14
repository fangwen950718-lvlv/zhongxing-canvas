import {test} from 'node:test';
import assert from 'node:assert/strict';
import { attachedImagesForJob, codexArgsForJob, progressFromCodexEvent } from '../scripts/image-codex-runner.mjs';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import { fixture } from './image-fixture.mjs';
process.env.ZHONGXING_TEST_RUNTIME=await mkdtemp(join(tmpdir(),'zhongxing-job-test-'));
const {createJob,createEditJob,readJob,setJobState,completeJob,publicJob,imageJobsPlugin}=await import('../scripts/image-jobs.mjs');
test('job lifecycle uses actual local image and is idempotently protected',async()=>{
 const job=await createJob({prompt:'测试用任务，不调用模型',ratio:'16:9'});assert.equal(job.status,'queued');assert.equal(job.width,1536);assert.equal(job.height,864);
 await setJobState(job.id,'running');assert.equal((await readJob(job.id)).status,'running');
 await completeJob(job.id,fixture);
 const result=await publicJob(job.id);assert.equal(result.status,'completed');assert.ok(result.dataURL.startsWith('data:image/png;base64,'));
 await assert.rejects(completeJob(job.id,'missing.png'),/已完成/);
});
test('annotated edit job persists original and annotation assets',async()=>{
 const data=`data:image/png;base64,${(await readFile(fixture)).toString('base64')}`;
 const job=await createEditJob({prompt:'1. 修改瓶盖颜色',ratio:'4:3',width:800,height:600,originalDataURL:data,annotatedDataURL:data,referenceImages:[{name:'材质参考.png',dataURL:data}]});
 assert.equal(job.kind,'edit');assert.equal(job.sourceWidth,800);assert.equal(job.sourceHeight,600);
 assert.ok((await readFile(job.originalPath)).length>0);assert.ok((await readFile(job.annotatedPath)).length>0);
 assert.equal(job.referencePaths.length,1);assert.equal(job.referenceNames[0],'材质参考.png');assert.ok((await readFile(job.referencePaths[0])).length>0);
 assert.deepEqual(attachedImagesForJob(job),[job.originalPath,job.annotatedPath,job.referencePaths[0]]);
});
test('generation job persists optional reference images and runner attaches them',async()=>{
 const data=`data:image/png;base64,${(await readFile(fixture)).toString('base64')}`;
 const job=await createJob({prompt:'参考这张图的材质生成新画面',ratio:'1:1',referenceImages:[{name:'参考.png',dataURL:data}]});
 assert.equal(job.referencePaths.length,1);assert.equal(job.referenceNames[0],'参考.png');
 assert.deepEqual(attachedImagesForJob(job),job.referencePaths);
 const args=codexArgsForJob(job,'/project');const separator=args.indexOf('--');
 assert.ok(separator>args.indexOf('--image'));assert.match(args[separator+1],/任务包含 1 张用户参考图/);
});
test('job validation rejects traversal, invalid ratio, empty prompts, and fake images',async()=>{
 await assert.rejects(readJob('../../private'),/无效任务/);await assert.rejects(createJob({prompt:'',ratio:'1:1'}));await assert.rejects(createJob({prompt:'测试',ratio:'3:0'}));
 const job=await createJob({prompt:'测试',ratio:'1:1'});await assert.rejects(completeJob(job.id,fileURLToPath(new URL('../package.json',import.meta.url))),/真实/);assert.equal((await readJob(job.id)).status,'queued');
 const manyReferences=Array.from({length:9},(_,index)=>({name:`参考-${index}.png`,dataURL:`data:image/png;base64,${Buffer.from(`tiny-${index}`).toString('base64')}`}));
 assert.equal((await createJob({prompt:'测试多图',ratio:'1:1',referenceImages:manyReferences})).referencePaths.length,9);
 await setJobState(job.id,'failed','模拟失败');assert.equal((await readJob(job.id)).message,'模拟失败');
});
test('web bridge rejects foreign origins before any filesystem action',async()=>{
 let middleware:any;imageJobsPlugin().configureServer({middlewares:{use(fn:any){middleware=fn;}}});
 for(const headers of [{host:'evil.test'},{host:'127.0.0.1:4317',origin:'https://evil.test'}]){
  const response:any={headers:{},setHeader(k:string,v:string){this.headers[k]=v;}};
  const data=await new Promise<string>(resolve=>{response.end=resolve;middleware({url:'/api/image-jobs',method:'POST',headers},response,()=>{});});
  assert.equal(response.statusCode,403);assert.match(data,/只允许本机/);
 }
});
test('Codex image events map to visible canvas progress', () => {
  assert.deepEqual(progressFromCodexEvent({ type: 'thread.started', thread_id: 'thread-1' }), { progress: 8, message: 'Codex 已接收任务', threadId: 'thread-1' });
  assert.equal(progressFromCodexEvent({ type: 'item.completed', item: { type: 'agent_message', text: '内置生图正在执行中。' } })?.progress, 48);
  assert.equal(progressFromCodexEvent({ type: 'item.started', item: { type: 'command_execution', command: 'node scripts/image-jobs.mjs complete id file' } })?.progress, 90);
});
