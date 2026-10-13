import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {deleteInput,paginationInput,version} from '../validation';
import {KEYWORD_SELECT,METRIC_SELECT,likeOf,plain,type Keyword,type Metric} from './records';

const phrase=z.string().trim().min(1).max(60);
const category=z.string().trim().max(30);
const note=z.string().trim().max(200);
const createInput=z.object({phrase,category:category.default(''),note:note.default(''),status:z.enum(['active','hidden']).default('active')}).strict();
const updateInput=z.object({phrase:phrase.optional(),category:category.optional(),note:note.optional(),status:z.enum(['active','hidden']).optional(),version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
const count=z.number().int().min(0).max(100_000_000);
const metricInput=z.object({pcVolume:count,mobileVolume:count,documentCount:count,measuredAt:z.iso.datetime({offset:true}).optional()}).strict();
const queryInput=paginationInput.extend({status:z.enum(['active','hidden']).optional(),category:category.optional()});

const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));
function row(db:Database,id:string):Keyword{
 const r=db.prepare(`${KEYWORD_SELECT} WHERE id=?`).get(id) as Keyword|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','키워드를 찾을 수 없습니다.');
 return plain(r);
}
function assertPhraseFree(db:Database,value:string,exceptId=''){
 if(db.prepare('SELECT 1 FROM keywords WHERE phrase=? COLLATE NOCASE AND id<>?').get(value,exceptId))throw new AppError(409,'KEYWORD_EXISTS','같은 키워드가 이미 있습니다.');
}
export const metricsOf=(db:Database,keywordId:string)=>(db.prepare(`${METRIC_SELECT} WHERE keyword_id=? ORDER BY measured_at DESC,created_at DESC`).all(keywordId) as Metric[]).map(plain);

export function listAdminKeywords(db:Database,actorId:string,query:unknown){
 authorize(db,actorId);
 const {page,pageSize,q,status,category:cat}=queryInput.parse(query);
 const where=["(phrase LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')"],params:(string|number)[]=[likeOf(q),likeOf(q)];
 if(status){where.push('status=?');params.push(status);}
 if(cat){where.push('category=?');params.push(cat);}
 const sql=`WHERE ${where.join(' AND ')}`;
 const {total}=db.prepare(`SELECT count(*) AS total FROM keywords ${sql}`).get(...params) as {total:number};
 const rows=(db.prepare(`${KEYWORD_SELECT} ${sql} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as Keyword[]).map(plain);
 return{data:rows.map(k=>({...k,latest:metricsOf(db,k.id)[0]??null})),pagination:{page,pageSize,total}};
}
export function getAdminKeyword(db:Database,actorId:string,id:string){
 authorize(db,actorId);
 const k=row(db,id),metrics=metricsOf(db,id);
 return{...k,metrics,latest:metrics[0]??null};
}
export function createKeyword(db:Database,actorId:string,input:unknown,now=Date.now()):Keyword{
 authorize(db,actorId);
 const v=createInput.parse(input);
 const id=randomUUID();
 return transaction(db,()=>{
  assertPhraseFree(db,v.phrase);
  db.prepare('INSERT INTO keywords(id,phrase,category,status,note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,v.phrase,v.category,v.status,v.note,actorId,now,now);
  audit(db,actorId,'admin.keyword.create','keyword',id);
  return row(db,id);
 });
}
export function updateKeyword(db:Database,actorId:string,id:string,input:unknown):Keyword{
 authorize(db,actorId);
 const {version:expected,...v}=updateInput.parse(input);
 return transaction(db,()=>{
  if(row(db,id).version!==expected)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  if(v.phrase!==undefined)assertPhraseFree(db,v.phrase,id);
  db.prepare('UPDATE keywords SET phrase=coalesce(?,phrase),category=coalesce(?,category),note=coalesce(?,note),status=coalesce(?,status),version=version+1,updated_at=? WHERE id=? AND version=?')
   .run(v.phrase??null,v.category??null,v.note??null,v.status??null,Date.now(),id,expected);
  audit(db,actorId,'admin.keyword.update','keyword',id,{fields:Object.keys(v)});
  return row(db,id);
 });
}
export function deleteKeyword(db:Database,actorId:string,id:string,input:unknown){
 authorize(db,actorId);
 const {version:expected}=deleteInput.parse(input);
 return transaction(db,()=>{
  if(row(db,id).version!==expected)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  db.prepare('DELETE FROM keywords WHERE id=? AND version=?').run(id,expected);
  audit(db,actorId,'admin.keyword.delete','keyword',id);
  return{deleted:true};
 });
}
/** 관리자가 직접 확인한 지표를 기록한다(출처 'manual'). 검색광고 API 연동은 미설정. */
export function addKeywordMetric(db:Database,actorId:string,keywordId:string,input:unknown,now=Date.now()):Metric{
 authorize(db,actorId);
 const v=metricInput.parse(input);
 return transaction(db,()=>{
  row(db,keywordId);
  const id=randomUUID();
  db.prepare("INSERT INTO keyword_metrics(id,keyword_id,pc_volume,mobile_volume,document_count,source,measured_at,created_by,created_at) VALUES(?,?,?,?,?,'manual',?,?,?)")
   .run(id,keywordId,v.pcVolume,v.mobileVolume,v.documentCount,v.measuredAt?Date.parse(v.measuredAt):now,actorId,now);
  audit(db,actorId,'admin.keyword.metric.create','keyword',keywordId);
  return plain(db.prepare(`${METRIC_SELECT} WHERE id=?`).get(id) as Metric);
 });
}
export function deleteKeywordMetric(db:Database,actorId:string,keywordId:string,metricId:string){
 authorize(db,actorId);
 return transaction(db,()=>{
  const r=db.prepare('DELETE FROM keyword_metrics WHERE id=? AND keyword_id=?').run(metricId,keywordId);
  if(r.changes===0)throw new AppError(404,'NOT_FOUND','지표를 찾을 수 없습니다.');
  audit(db,actorId,'admin.keyword.metric.delete','keyword',keywordId);
  return{deleted:true};
 });
}
