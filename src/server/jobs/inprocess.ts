import {hostname} from 'node:os';
import {database} from '../database';
import {runAllJobsOnce,type DrainState} from './drain';

const g=globalThis as {__naeoInprocessWorker?:AbortController};

/** 웹 프로세스 안에서 작업을 직접 처리한다. `npm run worker`를 따로 띄우지 않아도
 *  스캔·인용 확인·생성·메일·내보내기가 동작하게 한다. lease가 있어 외부 워커와
 *  동시에 띄워도 같은 작업을 두 번 실행하지 않는다. */
export function startInProcessWorker(){
 if(g.__naeoInprocessWorker)return g.__naeoInprocessWorker;
 const controller=new AbortController();g.__naeoInprocessWorker=controller;
 const db=database(),workerId=`inprocess-${hostname()}-${process.pid}`,state:DrainState={maintained:0,retained:0};
 const idleMs=Number(process.env.NAEO_WORKER_IDLE_MS)||2000;
 const log=(msg:string)=>process.stdout.write(`[inprocess-worker] ${msg}\n`);
 const sleep=(ms:number)=>new Promise<void>(r=>{
  const onAbort=()=>{clearTimeout(t);r();};
  const t=setTimeout(()=>{controller.signal.removeEventListener('abort',onAbort);r();},ms);
  controller.signal.addEventListener('abort',onAbort,{once:true});
 });
 const tick=async()=>{
  try{const ran=await runAllJobsOnce(db,workerId,state,log,controller.signal);
   if(!ran&&!controller.signal.aborted)await sleep(idleMs);
  }catch(e){log(`job error: ${e instanceof Error?e.message:String(e)}`);if(!controller.signal.aborted)await sleep(idleMs);}
  if(!controller.signal.aborted)void tick();
 };
 void tick();
 process.stdout.write(`[inprocess-worker] ${workerId} started\n`);
 return controller;
}
