import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {deleteInput} from '../validation';
import {balance,record} from '../credits/ledger';
import {periodRange} from '../ranking/ranking';
import {grantRewardInput,rankingRewardInput,rewardQueryInput} from './validation';

export type RewardKind='event'|'ranking'|'manual'|'gift';
export type Reward={id:string;userId:string;kind:RewardKind;tokens:number;item:string;description:string;eventId:string|null;sourceKey:string|null;entryId:string|null;status:'granted'|'revoked';version:number;createdAt:number;revokedAt:number|null};
const SELECT='SELECT id,user_id AS userId,kind,tokens,item,description,event_id AS eventId,source_key AS sourceKey,entry_id AS entryId,status,version,created_at AS createdAt,revoked_at AS revokedAt FROM rewards';
const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));

function eventIdOf(db:Database,slug:string|undefined):string|null{
 if(!slug)return null;
 const r=db.prepare('SELECT id FROM events WHERE slug=?').get(slug) as {id:string}|undefined;
 if(!r)throw new AppError(404,'EVENT_NOT_FOUND','연결할 이벤트를 찾을 수 없습니다.');
 return r.id;
}
/** 이벤트 당첨 내역(공개): 유효한 리워드만, 닉네임은 첫 글자만 보이게 가린다. */
const mask=(n:string)=>{const c=[...n];return c.length<=1?'*':c[0]+'*'.repeat(Math.min(c.length-1,4));};
export function eventWinners(db:Database,eventId:string,limit=20){
 return (db.prepare(`SELECT coalesce(p.nickname,'') AS nickname,r.kind,r.tokens,r.item,r.description,r.created_at AS createdAt FROM rewards r LEFT JOIN profiles p ON p.user_id=r.user_id
  WHERE r.event_id=? AND r.status='granted' ORDER BY r.created_at DESC,r.rowid DESC LIMIT ?`).all(eventId,limit) as {nickname:string;kind:RewardKind;tokens:number;item:string;description:string;createdAt:number}[])
  .map(r=>({...r,nickname:mask(r.nickname)}));
}
export function rewardById(db:Database,id:string):Reward{
 const r=db.prepare(`${SELECT} WHERE id=?`).get(id) as Reward|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','리워드를 찾을 수 없습니다.');
 return{...r};
}

/**
 * 토큰 리워드 지급(트랜잭션 안에서 호출). 원장에는 ref_type 'reward'로 한 번만 기록된다.
 * sourceKey가 같은 지급이 이미 유효하면 null(중복 지급 안 함).
 */
export function issueReward(db:Database,e:{userId:string;kind:RewardKind;tokens:number;item?:string;description:string;sourceKey?:string;entryId?:string;eventId?:string|null;actorId:string|null},now:number):Reward|null{
 if(e.sourceKey&&db.prepare("SELECT 1 FROM rewards WHERE source_key=? AND status='granted'").get(e.sourceKey))return null;
 const id=randomUUID();
 db.prepare('INSERT INTO rewards(id,user_id,kind,tokens,item,description,event_id,source_key,entry_id,granted_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .run(id,e.userId,e.kind,e.tokens,e.item??'',e.description,e.eventId??null,e.sourceKey??null,e.entryId??null,e.actorId,now);
 if(e.tokens>0)record(db,{ownerId:e.userId,delta:e.tokens,reason:'grant',refType:'reward',refId:id,note:e.description.slice(0,200),createdBy:e.actorId},now);
 return rewardById(db,id);
}

/** 리워드 회수(트랜잭션 안에서 호출). 이미 쓴 토큰 때문에 잔액이 음수가 되면 거절한다. 상품 리워드는 원장 기록이 없다. */
export function cancelReward(db:Database,reward:Reward,actorId:string,now:number):Reward{
 if(reward.status!=='granted')throw new AppError(409,'REWARD_REVOKED','이미 회수된 리워드입니다.');
 if(balance(db,reward.userId)<reward.tokens)throw new AppError(409,'NEGATIVE_BALANCE','회원이 이미 토큰을 사용해 회수할 수 없습니다.');
 db.prepare("UPDATE rewards SET status='revoked',version=version+1,revoked_by=?,revoked_at=? WHERE id=?").run(actorId,now,reward.id);
 if(reward.tokens>0)record(db,{ownerId:reward.userId,delta:-reward.tokens,reason:'adjust',refType:'reward',refId:reward.id,note:`회수: ${reward.description}`.slice(0,200),createdBy:actorId},now);
 return rewardById(db,reward.id);
}

export function listRewards(db:Database,actorId:string,query:unknown){
 authorize(db,actorId);
 const {page,pageSize,q,status,kind}=rewardQueryInput.parse(query);
 const like=`%${q.replace(/[\\%_]/g,v=>'\\'+v)}%`;
 const where=["(r.description LIKE ? ESCAPE '\\' OR r.item LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR p.nickname LIKE ? ESCAPE '\\')"],params:(string|number)[]=[like,like,like,like];
 if(status){where.push('r.status=?');params.push(status);}
 if(kind){where.push('r.kind=?');params.push(kind);}
 const from=`FROM rewards r JOIN users u ON u.id=r.user_id LEFT JOIN profiles p ON p.user_id=r.user_id WHERE ${where.join(' AND ')}`;
 const {total}=db.prepare(`SELECT count(*) AS total ${from}`).get(...params) as {total:number};
 const rows=db.prepare(`SELECT r.id,r.user_id AS userId,u.email AS email,coalesce(p.nickname,'') AS nickname,r.kind,r.tokens,r.item,r.description,r.event_id AS eventId,r.source_key AS sourceKey,r.entry_id AS entryId,r.status,r.version,r.created_at AS createdAt,r.revoked_at AS revokedAt
  ${from} ORDER BY r.created_at DESC,r.rowid DESC LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as (Reward&{email:string;nickname:string})[];
 return{data:rows.map(r=>({...r})),pagination:{page,pageSize,total}};
}
export function listMyRewards(db:Database,userId:string,page=1){
 const {page:requested}=rewardQueryInput.parse({page});
 const {total}=db.prepare('SELECT count(*) AS total FROM rewards WHERE user_id=?').get(userId) as {total:number};
 const current=Math.min(requested,Math.max(1,Math.ceil(total/100)));
 const data=(db.prepare(`${SELECT} WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100 OFFSET ?`).all(userId,(current-1)*100) as Reward[]).map(r=>({...r}));
 return {data,pagination:{page:current,pageSize:100,total}};
}
export const myRewards=(db:Database,userId:string):Reward[]=>listMyRewards(db,userId).data;

export function grantReward(db:Database,actorId:string,input:unknown,now=Date.now()):Reward{
 authorize(db,actorId);
 const v=grantRewardInput.parse(input);
 return transaction(db,()=>{
  const userId=v.userId??(db.prepare('SELECT id FROM users WHERE email=?').get(v.email!) as {id:string}|undefined)?.id;
  if(!userId)throw new AppError(404,'USER_NOT_FOUND','해당 이메일의 회원이 없습니다.');
  userById(db,userId);
  const r=issueReward(db,{userId,kind:v.item?'gift':'manual',tokens:v.tokens??0,item:v.item,description:v.description,eventId:eventIdOf(db,v.eventSlug),actorId},now)!;
  audit(db,actorId,'admin.reward.grant','reward',r.id,{userId,tokens:r.tokens,item:r.item});
  return r;
 });
}
export function revokeReward(db:Database,actorId:string,id:string,input:unknown,now=Date.now()):Reward{
 authorize(db,actorId);
 const {version}=deleteInput.parse(input);
 return transaction(db,()=>{
  const r=rewardById(db,id);
  if(r.version!==version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 처리했습니다. 최신 내용을 불러와주세요.');
  const done=cancelReward(db,r,actorId,now);
  audit(db,actorId,'admin.reward.revoke','reward',id,{userId:r.userId,tokens:r.tokens});
  return done;
 });
}

/** 확정된 주간·월간 순위의 상위 N명에게 토큰 리워드. 같은 기간·회원은 한 번만 지급된다. */
export function grantRankingRewards(db:Database,actorId:string,input:unknown,now=Date.now()){
 authorize(db,actorId);
 const v=rankingRewardInput.parse(input);
 const p=periodRange(v.period,v.offset,now);
 return transaction(db,()=>{
  if(!db.prepare('SELECT 1 FROM ranking_periods WHERE period_type=? AND period_key=?').get(v.period,p.key))throw new AppError(409,'PERIOD_NOT_CONFIRMED','먼저 이 기간의 순위를 확정해주세요.');
  const winners=db.prepare('SELECT user_id AS userId,rank FROM ranking_snapshots WHERE period_type=? AND period_key=? AND rank<=? ORDER BY rank').all(v.period,p.key,v.top) as {userId:string;rank:number}[];
  const eventId=eventIdOf(db,v.eventSlug);
  const granted=winners.filter(w=>issueReward(db,{userId:w.userId,kind:'ranking',tokens:v.tokens,description:`${p.label} 랭킹 ${w.rank}위 리워드`,sourceKey:`ranking:${v.period}:${p.key}:${w.userId}`,eventId,actorId},now)).length;
  audit(db,actorId,'admin.reward.ranking','ranking',`${v.period}:${p.key}`,{top:v.top,tokens:v.tokens,granted});
  return{period:p,granted,eligible:winners.length};
 });
}
