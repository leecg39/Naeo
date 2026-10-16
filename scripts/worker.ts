import {runInquiryMailOnce} from '../src/server/inquiries/mail';
/**
 * 진단·AI 인용 확인·AI 글 생성 작업 worker. 웹 서버와 같은 DB(NAEO_DATABASE_PATH)를 보고 대기 작업을 하나씩 처리한다.
 * 실행: npm run worker   (여러 개를 띄워도 lease로 같은 작업을 두 번 실행하지 않는다)
 */
import {mailConfig} from '../src/server/mail/provider';
import {runMailOnce} from '../src/server/mail/worker';
import {runPersonalExportOnce,cleanupPersonalExports} from '../src/server/privacy/personal-export';
import {hostname} from 'node:os';
import {database} from '../src/server/database';
import {runWorkerOnce} from '../src/server/jobs/worker';
import {runGenerationOnce} from '../src/server/generation/worker';
import {runtimeGenerationProvider} from '../src/server/generation/runtime-provider';
import {scanHandler} from '../src/server/analysis/scan-handler';
import {billingMaintenance} from '../src/server/billing/maintenance';
import {cleanupExports} from '../src/server/creative/exports';
import {runRetention} from '../src/server/ops/retention';
import {uploadDir} from '../src/server/writing/writing-api';
import {cleanupMedia} from '../src/server/writing/media-cleanup';
import {citationConfig,serpApiProvider} from '../src/server/citations/provider';
import {runCitationOnce} from '../src/server/citations/worker';

async function main(){
 const workerId=`${hostname()}-${process.pid}`;
 const controller=new AbortController();
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>controller.abort());
 const db=database();
 process.stdout.write(`[worker] ${workerId} started\n`);
 const provider=runtimeGenerationProvider(db);
 const scans=scanHandler(db),idleMs=Number(process.env.NAEO_WORKER_IDLE_MS)||2000;
 let maintained=0,retained=0;
 while(!controller.signal.aborted){
  const billing=billingMaintenance(db,maintained);
  if(billing){const personal=cleanupPersonalExports(db,uploadDir(),billing.at);if(personal.removed||personal.failed||personal.scanError)process.stdout.write(`[worker] personal export cleanup ${JSON.stringify(personal)}\n`);const media=cleanupMedia(db,uploadDir(),billing.at);if(media.removed||media.failed||media.scanError)process.stdout.write(`[worker] media cleanup ${JSON.stringify(media)}\n`);}
  if(billing&&billing.at-retained>=3600_000){retained=billing.at;const r=runRetention(db,billing.at);process.stdout.write(`[worker] retention ${JSON.stringify(r)}\n`);}
  if(billing){const removed=cleanupExports(db,uploadDir(),billing.at);if(removed)process.stdout.write(`[worker] exports removed=${removed}\n`);maintained=billing.at;if(billing.ended||billing.renewed||billing.expiredOrders)process.stdout.write(`[worker] billing ended=${billing.ended} renewed=${billing.renewed} expiredOrders=${billing.expiredOrders}\n`);}
  const replied=await runInquiryMailOnce(db,mailConfig()),mailed=await runMailOnce(db,mailConfig()),exported=runPersonalExportOnce(db,uploadDir());
  const citation=citationConfig();
  const ran=(await runWorkerOnce(db,workerId,scans))??(await runCitationOnce(db,workerId,citation?serpApiProvider(citation):null))??(await runGenerationOnce(db,workerId,provider))??(replied||mailed||exported);
  if(!ran)await new Promise<void>(resolve=>{const t=setTimeout(resolve,idleMs);controller.signal.addEventListener('abort',()=>{clearTimeout(t);resolve();},{once:true});});
 }
 process.stdout.write(`[worker] ${workerId} stopped\n`);
}

main().catch(error=>{
 process.stderr.write(`[worker] fatal: ${error instanceof Error?error.message:String(error)}\n`);
 process.exitCode=1;
});
