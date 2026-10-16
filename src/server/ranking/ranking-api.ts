import {z} from 'zod';
import type {Database} from '../database';
import {requireAdmin,type User} from '../auth';
import {audit} from '../audit';
import {body,json} from '../http';
import {champions,confirmPeriod,liveRanking,memberHistory,periodRange,titlesOf} from './ranking';

const confirmInput=z.object({period:z.enum(['week','month']),offset:z.number().int().min(-52).max(-1)}).strict();

/** 지난 기간을 처음 볼 때 끝난 기간이면 확정 스냅숏을 만든다(이후 순위가 바뀌지 않게). */
export function ensureConfirmed(db:Database,params:URLSearchParams,now=Date.now()){
 const type=params.get('period'),offset=Number(params.get('offset')??0);
 if((type==='week'||type==='month')&&Number.isInteger(offset)&&offset<0&&offset>=-52&&periodRange(type,offset,now).end<=now)confirmPeriod(db,type,offset,now);
}

/** 로그인 없이 보는 랭킹·명예의 전당. 로그인 회원이면 내 순위를 함께 준다. */
export function publicRankingApi(db:Database,request:Request,viewer:User|null):Response|null{
 const {pathname:path,searchParams}=new URL(request.url);
 if(request.method!=='GET')return null;
 if(path==='/api/rankings'){ensureConfirmed(db,searchParams);return json(liveRanking(db,Object.fromEntries(searchParams),viewer?.id??null));}
 if(path==='/api/rankings/champions')return json({data:champions(db).map(r=>({periodType:r.periodType,periodKey:r.periodKey,nickname:r.nickname,naverId:r.naverId,score:r.score}))});
 return null;
}

/** 내 랭킹 이력·칭호, 관리자 기간 확정. */
export async function memberRankingApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path}=new URL(request.url),method=request.method;
 if(path==='/api/rankings/me'&&method==='GET')return json({data:{history:memberHistory(db,user.id),titles:titlesOf(db,user.id)}});
 if(path==='/api/admin/rankings/confirm'&&method==='POST'){
  requireAdmin(user);
  const v=await body(request,confirmInput);
  const r=confirmPeriod(db,v.period,v.offset);
  audit(db,user.id,'admin.ranking.confirm','ranking_period',`${v.period}:${r.period.key}`,{entries:r.entries});
  return json({data:r});
 }
 return null;
}
