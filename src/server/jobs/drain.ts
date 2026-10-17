import type {Database} from '../database';
import {runWorkerOnce,type ScanHandler} from './worker';
import {runCitationOnce} from '../citations/worker';
import {citationConfig,serpApiProvider} from '../citations/provider';
import {runGenerationOnce} from '../generation/worker';
import {runtimeGenerationProvider} from '../generation/runtime-provider';
import {imageConfig,openAIImageProvider} from '../generation/image-provider';
import {runMailOnce} from '../mail/worker';
import {mailConfig} from '../mail/provider';
import {runNotifyMailOnce} from '../mail/notify';
import {runInquiryMailOnce} from '../inquiries/mail';
import {runPersonalExportOnce,cleanupPersonalExports} from '../privacy/personal-export';
import {runCreativeExportOnce} from '../creative/worker';
import {cleanupExports} from '../creative/exports';
import {billingMaintenance} from '../billing/maintenance';
import {runRetention} from '../ops/retention';
import {cleanupMedia} from '../writing/media-cleanup';
import {uploadDir} from '../writing/writing-api';
import {enqueueAutoscans} from './autoscan';
import {scanHandler} from '../analysis/scan-handler';

export type DrainState={maintained:number;retained:number};

/** 테스트용 핸들러 주입. 기본은 실제 스캔 핸들러(RSS 수집 포함). */
export type DrainOverrides={scan?:ScanHandler};

/** 워커 루프의 한 차례: 유지보수·메일·내보내기·스캔·인용·생성을 순서대로 한 번씩 시도한다. */
export async function runAllJobsOnce(db:Database,workerId:string,state:DrainState,log:(msg:string)=>void,signal:AbortSignal,overrides:DrainOverrides={}){
 const billing=billingMaintenance(db,state.maintained);
 if(billing){
  const personal=cleanupPersonalExports(db,uploadDir(),billing.at);
  if(personal.removed||personal.failed||personal.scanError)log(`personal export cleanup ${JSON.stringify(personal)}`);
  const media=cleanupMedia(db,uploadDir(),billing.at);
  if(media.removed||media.failed||media.scanError)log(`media cleanup ${JSON.stringify(media)}`);
  if(billing.at-state.retained>=3600_000){state.retained=billing.at;log(`retention ${JSON.stringify(runRetention(db,billing.at))}`);}
  const removed=cleanupExports(db,uploadDir(),billing.at);if(removed)log(`exports removed=${removed}`);
  state.maintained=billing.at;
  const autoscan=enqueueAutoscans(db,billing.at);if(autoscan)log(`autoscan queued=${autoscan}`);
  if(billing.ended||billing.renewed||billing.expiredOrders)log(`billing ended=${billing.ended} renewed=${billing.renewed} expiredOrders=${billing.expiredOrders}`);
 }
 const mail=mailConfig();
 const replied=await runInquiryMailOnce(db,mail),mailed=await runMailOnce(db,mail),notified=await runNotifyMailOnce(db,mail),exported=runPersonalExportOnce(db,uploadDir());
 const citation=citationConfig();
 const creative=await runCreativeExportOnce(db,uploadDir(),workerId,{signal});
 const scans=overrides.scan??scanHandler(db),provider=runtimeGenerationProvider(db),images=imageConfig();
 return (await runWorkerOnce(db,workerId,scans))
  ??(await runCitationOnce(db,workerId,citation?serpApiProvider(citation):null))
  ??(await runGenerationOnce(db,workerId,provider,{imageProvider:images?openAIImageProvider(images):null,uploadDir:uploadDir()}))
  ??(replied||mailed||notified||exported||creative);
}
