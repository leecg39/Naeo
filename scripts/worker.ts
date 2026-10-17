/**
 * 진단·AI 인용 확인·AI 글 생성 작업 worker. 웹 서버와 같은 DB(NAEO_DATABASE_PATH)를 보고 대기 작업을 하나씩 처리한다.
 * 실행: npm run worker   (여러 개를 띄워도 lease로 같은 작업을 두 번 실행하지 않는다)
 * 웹 프로세스도 instrumentation으로 같은 루프(src/server/jobs/drain.ts)를 돌리므로
 * 단독 배포에서는 이 스크립트가 없어도 잡이 처리된다. NAEO_INPROCESS_WORKER=0 참조.
 */
import {hostname} from 'node:os';
import {database} from '../src/server/database';
import {runAllJobsOnce} from '../src/server/jobs/drain';

async function main(){
 const workerId=`${hostname()}-${process.pid}`;
 const controller=new AbortController();
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>controller.abort());
 const db=database(),idleMs=Number(process.env.NAEO_WORKER_IDLE_MS)||2000,state={maintained:0,retained:0};
 const log=(msg:string)=>process.stdout.write(`[worker] ${msg}\n`);
 const sleep=(ms:number)=>new Promise<void>(r=>{
  const onAbort=()=>{clearTimeout(t);r();};
  const t=setTimeout(()=>{controller.signal.removeEventListener('abort',onAbort);r();},ms);
  controller.signal.addEventListener('abort',onAbort,{once:true});
 });
 process.stdout.write(`[worker] ${workerId} started\n`);
 while(!controller.signal.aborted){
  try{
   const ran=await runAllJobsOnce(db,workerId,state,log,controller.signal);
   if(!ran)await sleep(idleMs);
  }catch(e){log(`job error: ${e instanceof Error?e.message:String(e)}`);if(!controller.signal.aborted)await sleep(idleMs);}
 }
 process.stdout.write(`[worker] ${workerId} stopped\n`);
}

main().catch(error=>{
 process.stderr.write(`[worker] fatal: ${error instanceof Error?error.message:String(error)}\n`);
 process.exitCode=1;
});
