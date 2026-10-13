import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {AppError} from '../errors';
import {version} from '../validation';
import type {AnalysisReport} from './rules';

export type ActionItem={id:string;resultId:string;criterion:string;title:string;status:'open'|'done';version:number;createdAt:number;updatedAt:number};
const SELECT='SELECT id,result_id AS resultId,criterion,title,status,version,created_at AS createdAt,updated_at AS updatedAt FROM action_items';
const updateInput=z.object({status:z.enum(['open','done']),version}).strict();

/** 진단 결과의 할 일을 '오늘 할 일'로 저장한다(결과·기준당 하나). */
export function createActionItems(db:Database,ownerId:string,resultId:string,report:AnalysisReport,now:number){
 const insert=db.prepare("INSERT INTO action_items(id,owner_id,result_id,criterion,title,status,created_at,updated_at) VALUES(?,?,?,?,?,'open',?,?) ON CONFLICT(result_id,criterion) DO NOTHING");
 for(const a of report.actions)insert.run(randomUUID(),ownerId,resultId,a.criterion,a.title,now,now);
}

/** 가장 최근 진단 결과의 할 일(대표 블로그 우선). */
export function listActionItems(db:Database,ownerId:string):ActionItem[]{
 const latest=db.prepare('SELECT r.id FROM scan_results r JOIN blogs b ON b.id=r.blog_id WHERE r.owner_id=? ORDER BY b.is_primary DESC,r.measured_at DESC LIMIT 1').get(ownerId) as {id:string}|undefined;
 if(!latest)return[];
 return (db.prepare(`${SELECT} WHERE owner_id=? AND result_id=? ORDER BY created_at,id`).all(ownerId,latest.id) as ActionItem[]).map(r=>({...r}));
}

export function updateActionItem(db:Database,ownerId:string,id:string,input:unknown):ActionItem{
 const v=updateInput.parse(input);
 return transaction(db,()=>{
  const r=db.prepare(`${SELECT} WHERE id=? AND owner_id=?`).get(id,ownerId) as ActionItem|undefined;
  if(!r)throw new AppError(404,'NOT_FOUND','할 일을 찾을 수 없습니다.');
  if(r.version!==v.version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 바꿨습니다. 새로고침해주세요.');
  db.prepare('UPDATE action_items SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(v.status,Date.now(),id,v.version);
  return{...(db.prepare(`${SELECT} WHERE id=?`).get(id) as ActionItem)};
 });
}
