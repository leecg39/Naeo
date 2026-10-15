import {mailConfig} from '../mail/provider';
import type {Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {providerConfig} from '../generation/generation';
import {tossProvider} from '../billing/provider';
import {oauthConfig} from '../oauth/providers';

export const WORKER_STALE=2*60_000;
const count=(db:Database,sql:string,...p:(string|number)[])=>(db.prepare(sql).get(...p) as {n:number}).n;
/** 운영 상태: 스키마 버전, 작업자 생존(2분 안 신호), 작업 큐, 외부 연동 설정 여부. 비밀값은 내보내지 않는다. */
export function serviceHealth(db:Database,actorId:string,now=Date.now()){
 requireAdmin(userById(db,actorId));
 const since=now-86_400_000;
 const queue=(table:string)=>({queued:count(db,`SELECT count(*) AS n FROM ${table} WHERE state='queued'`),running:count(db,`SELECT count(*) AS n FROM ${table} WHERE state='running'`),failed24h:count(db,`SELECT count(*) AS n FROM ${table} WHERE state='failed' AND updated_at>=?`,since)});
 return{
  schemaVersion:count(db,'SELECT max(version) AS n FROM schema_migrations'),
  workers:(db.prepare('SELECT worker_id AS workerId,started_at AS startedAt,last_seen_at AS lastSeenAt,processed,failed FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 10').all() as {workerId:string;startedAt:number;lastSeenAt:number;processed:number;failed:number}[]).map(w=>({...w,alive:now-w.lastSeenAt<WORKER_STALE})),
  queues:{scan:queue('scan_jobs'),generation:queue('generation_jobs'),exportsCollecting:count(db,"SELECT count(*) AS n FROM export_jobs WHERE state='collecting'")},
  mailQueue:{pending:count(db,"SELECT count(*) AS n FROM account_mail WHERE state IN ('queued','retry','sending')"),failed:count(db,"SELECT count(*) AS n FROM account_mail WHERE state='failed'")},
  mediaDeletion:{pending:count(db,'SELECT count(*) AS n FROM media_deletions'),retrying:count(db,'SELECT count(*) AS n FROM media_deletions WHERE attempts>0')},
  integrations:{ai:!!providerConfig().apiKey,aiCitation:false,payments:tossProvider()!==null,google:oauthConfig('google')!==null,naver:oauthConfig('naver')!==null,mail:mailConfig()!==null,sms:false},
 };
}
