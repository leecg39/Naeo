import {z} from 'zod';
import {transaction,type Database} from '../database';
import {AppError} from '../errors';
import {getRecommendation} from './discovery-feed';
import {insertDraftRow,ownedDraft} from '../writing/drafts';
import {writingRecommendation,writingRecommendationBody} from '../../lib/writing-recommendation';

const input=z.object({version:z.number().int().positive(),titleIndex:z.number().int().min(0).max(2).default(0)}).strict();

/** 같은 추천을 다시 열면 사용자 편집을 보존한 기존 초안을 반환한다. AI 생성·토큰 차감은 하지 않는다. */
export function createRecommendationDraft(db:Database,ownerId:string,id:string,value:unknown,now=Date.now()){
 const v=input.parse(value);
 return transaction(db,()=>{
  const item=getRecommendation(db,ownerId,id);
  if(item.version!==v.version)throw new AppError(409,'VERSION_CONFLICT','추천이 변경되었습니다. 목록을 새로고침해주세요.');
  if(item.dismissed||item.written)throw new AppError(409,'RECOMMENDATION_INACTIVE','숨김 또는 작성 완료를 해제한 뒤 초안을 만들어주세요.');
  const existing=db.prepare('SELECT id FROM drafts WHERE owner_id=? AND recommendation_id=?').get(ownerId,id) as {id:string}|undefined;
  if(existing)return{draft:ownedDraft(db,ownerId,existing.id),reused:true};
  const plan=writingRecommendation(item);
  const draft=insertDraftRow(db,ownerId,{title:plan.titles[v.titleIndex],keyword:item.phrase,category:item.category.slice(0,30),body:writingRecommendationBody(item,plan)},now,'recommendation.draft.create');
  db.prepare('UPDATE drafts SET recommendation_id=? WHERE id=? AND owner_id=?').run(id,draft.id,ownerId);
  return{draft,reused:false};
 });
}
