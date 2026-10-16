import type {Database} from '../database';
import {AppError} from '../errors';
import {enqueueScan,kstDayStart} from './queue';

/**
 * 새 규칙(원본 미확인): '자동 스캔 요청'을 켠 회원의 대표 블로그를, 마지막 진단 요청 후 24시간이 지나면
 * 하루에 한 번 자동으로 큐에 넣는다. 멱등 키(auto:블로그:KST날짜)로 같은 날 중복 예약을 막고
 * 진단 중·하루 한도 초과·비활성 계정은 건너뛴다. 작업자가 매시간 점검한다.
 */
export const AUTOSCAN_INTERVAL_MS=24*3600_000,AUTOSCAN_BATCH=100;
export function enqueueAutoscans(db:Database,now=Date.now()):number{
 const blogs=db.prepare(`SELECT b.id,b.owner_id AS ownerId FROM blogs b
  JOIN notification_preferences p ON p.user_id=b.owner_id AND p.autoscan=1
  JOIN users u ON u.id=b.owner_id AND u.status='active'
  WHERE b.is_primary=1 AND NOT EXISTS(SELECT 1 FROM scan_jobs j WHERE j.blog_id=b.id AND j.created_at>=?)
  ORDER BY b.created_at LIMIT ?`).all(now-AUTOSCAN_INTERVAL_MS,AUTOSCAN_BATCH) as {id:string;ownerId:string}[];
 let queued=0;
 for(const b of blogs){
  try{enqueueScan(db,b.ownerId,{blogId:b.id,idempotencyKey:`auto:${b.id}:${kstDayStart(now)}`},now);queued++;}
  catch(e){if(!(e instanceof AppError))throw e;}
 }
 return queued;
}
