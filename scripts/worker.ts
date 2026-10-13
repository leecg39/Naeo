/**
 * 진단·AI 글 생성 작업 worker. 웹 서버와 같은 DB(NAEO_DATABASE_PATH)를 보고 대기 작업을 하나씩 처리한다.
 * 실행: npm run worker   (여러 개를 띄워도 lease로 같은 작업을 두 번 실행하지 않는다)
 */
import {hostname} from 'node:os';
import {database} from '../src/server/database';
import {runWorkerOnce} from '../src/server/jobs/worker';
import {runGenerationOnce} from '../src/server/generation/worker';
import {anthropicProvider,ProviderError,type Provider} from '../src/server/generation/provider';
import {providerConfig} from '../src/server/generation/generation';
import {scanHandler} from '../src/server/analysis/scan-handler';
import {billingMaintenance} from '../src/server/billing/maintenance';
import {cleanupExports} from '../src/server/creative/exports';
import {uploadDir} from '../src/server/writing/writing-api';

async function main(){
 const workerId=`${hostname()}-${process.pid}`;
 const controller=new AbortController();
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>controller.abort());
 const db=database();
 process.stdout.write(`[worker] ${workerId} started\n`);
 const config=providerConfig();
 // 키가 없으면 남은 작업을 실패·환급으로 정리한다(요청 단계에서 이미 거절하므로 보통 생기지 않는다).
 const provider:Provider=config.apiKey?anthropicProvider(config):async()=>{throw new ProviderError('PROVIDER_NOT_CONFIGURED','AI 글 생성 공급자가 설정되지 않았습니다.',false);};
 const scans=scanHandler(db),idleMs=Number(process.env.NAEO_WORKER_IDLE_MS)||2000;
 let maintained=0;
 while(!controller.signal.aborted){
  const billing=billingMaintenance(db,maintained);
  if(billing){const removed=cleanupExports(db,uploadDir(),billing.at);if(removed)process.stdout.write(`[worker] exports removed=${removed}\n`);maintained=billing.at;if(billing.ended||billing.renewed||billing.expiredOrders)process.stdout.write(`[worker] billing ended=${billing.ended} renewed=${billing.renewed} expiredOrders=${billing.expiredOrders}\n`);}
  const ran=(await runWorkerOnce(db,workerId,scans))??(await runGenerationOnce(db,workerId,provider));
  if(!ran)await new Promise<void>(resolve=>{const t=setTimeout(resolve,idleMs);controller.signal.addEventListener('abort',()=>{clearTimeout(t);resolve();},{once:true});});
 }
 process.stdout.write(`[worker] ${workerId} stopped\n`);
}

main().catch(error=>{
 process.stderr.write(`[worker] fatal: ${error instanceof Error?error.message:String(error)}\n`);
 process.exitCode=1;
});
