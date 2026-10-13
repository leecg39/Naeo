import {z} from 'zod';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {paginationInput} from '../validation';
import {refundJob,toJob,type GenerationJob,type JobRow} from './generation';

const listInput=paginationInput.extend({state:z.enum(['queued','running','succeeded','failed','canceled']).optional()});
export type AdminGeneration=GenerationJob&{ownerEmail:string;keyword:string};
const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));

export function listAdminGenerations(db:Database,actorId:string,query:unknown){
 authorize(db,actorId);
 const {page,pageSize,q,state}=listInput.parse(query);
 const like=`%${q.replace(/[\\%_]/g,c=>'\\'+c)}%`;
 const where=["(u.email LIKE ? ESCAPE '\\' OR json_extract(g.input_json,'$.keyword') LIKE ? ESCAPE '\\' OR coalesce(g.error_code,'') LIKE ? ESCAPE '\\')"],params:(string|number)[]=[like,like,like];
 if(state){where.push('g.state=?');params.push(state);}
 const sql=`FROM generation_jobs g JOIN users u ON u.id=g.owner_id WHERE ${where.join(' AND ')}`;
 const {total}=db.prepare(`SELECT count(*) AS total ${sql}`).get(...params) as {total:number};
 const rows=db.prepare(`SELECT g.*,u.email AS owner_email ${sql} ORDER BY g.created_at DESC,g.rowid DESC LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as (JobRow&{owner_email:string})[];
 return{data:rows.map(r=>({...toJob(r),ownerEmail:r.owner_email,keyword:(JSON.parse(r.input_json) as {keyword:string}).keyword})),pagination:{page,pageSize,total}};
}

/** 관리자 취소: 대기 작업은 즉시 취소·환급, 실행 중이면 취소 요청(감사 기록). */
export function adminCancelGeneration(db:Database,actorId:string,id:string,now=Date.now()):GenerationJob{
 authorize(db,actorId);
 return transaction(db,()=>{
  const r=db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(id) as JobRow|undefined;
  if(!r)throw new AppError(404,'NOT_FOUND','생성 작업을 찾을 수 없습니다.');
  if(r.state==='queued'){db.prepare("UPDATE generation_jobs SET state='canceled',completed_at=?,updated_at=? WHERE id=?").run(now,now,id);refundJob(db,r,now);}
  else if(r.state==='running')db.prepare('UPDATE generation_jobs SET cancel_requested=1,updated_at=? WHERE id=?').run(now,id);
  else throw new AppError(409,'GENERATION_FINISHED','이미 끝난 작업입니다.');
  audit(db,actorId,'admin.generation.cancel','generation_job',id);
  return toJob(db.prepare('SELECT * FROM generation_jobs WHERE id=?').get(id) as JobRow);
 });
}
