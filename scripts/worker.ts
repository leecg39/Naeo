/**
 * 진단 작업 worker. 웹 서버와 같은 DB(NAEO_DATABASE_PATH)를 보고 대기 작업을 하나씩 처리한다.
 * 실행: npm run worker   (여러 개를 띄워도 lease로 같은 작업을 두 번 실행하지 않는다)
 */
import {hostname} from 'node:os';
import {database} from '../src/server/database';
import {runWorkerLoop} from '../src/server/jobs/worker';
import {scanHandler} from '../src/server/analysis/scan-handler';

async function main(){
 const workerId=`${hostname()}-${process.pid}`;
 const controller=new AbortController();
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>controller.abort());
 const db=database();
 process.stdout.write(`[worker] ${workerId} started\n`);
 await runWorkerLoop(db,workerId,scanHandler(db),{signal:controller.signal,idleMs:Number(process.env.NAEO_WORKER_IDLE_MS)||2000});
 process.stdout.write(`[worker] ${workerId} stopped\n`);
}

main().catch(error=>{
 process.stderr.write(`[worker] fatal: ${error instanceof Error?error.message:String(error)}\n`);
 process.exitCode=1;
});
