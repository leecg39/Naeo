import {cleanupMail} from '../mail/worker';
import type {Database} from '../database';
import {kstDay,RAW_RETENTION_DAYS,rollupAnalytics} from './analytics';

const DAY=86_400_000;
/**
 * 보관 정책(작업자가 한 시간마다 실행):
 * - 방문 원본은 집계에 반영한 뒤 30일 지나면 삭제, 방문자 salt는 이틀 지나면 삭제(해시를 다시 이을 수 없게).
 * - 하루 넘게 신호 없는 작업자 기록 삭제, 감사 로그 1년, 만료된 세션·인가 코드·OAuth state 즉시, 만료 30일 지난 OAuth 토큰 삭제.
 * - 결제·환불 기록은 회계 기록이라 지우지 않는다(트리거로 보호).
 */
export function runRetention(db:Database,now=Date.now()){
 rollupAnalytics(db,now);
 const del=(sql:string,...p:(string|number)[])=>Number(db.prepare(sql).run(...p).changes);
 return{
  accountMail:cleanupMail(db,now),
  smsChallenges:del('DELETE FROM sms_challenges WHERE expires_at<=?',now),
  pageViews:del('DELETE FROM page_views WHERE created_at<?',now-RAW_RETENTION_DAYS*DAY),
  salts:del('DELETE FROM analytics_salts WHERE day<?',kstDay(now-DAY)),
  auditLogs:del('DELETE FROM audit_logs WHERE created_at<?',now-365*DAY),
  sessions:del('DELETE FROM sessions WHERE expires_at<=?',now),
  workers:del('DELETE FROM worker_heartbeats WHERE last_seen_at<?',now-DAY),
  oauth:del('DELETE FROM oauth_codes WHERE expires_at<=?',now)+del('DELETE FROM oauth_states WHERE expires_at<=?',now)+del('DELETE FROM oauth_tokens WHERE expires_at<?',now-30*DAY),
 };
}
