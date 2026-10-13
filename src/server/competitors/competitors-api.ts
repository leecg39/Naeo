import {z} from 'zod';
import type {Database} from '../database';
import type {User} from '../auth';
import {body,json,rateLimit} from '../http';
import {addCompetitor,deleteCompetitor,listCompetitors,refreshCompetitor,updateCompetitor} from './competitors';
import {listActionItems,updateActionItem} from '../analysis/action-items';

const ID='([a-f0-9-]{36})';
const anyJson=z.unknown();

/** 경쟁 블로그 CRUD·갱신, 오늘 할 일 완료/해제(회원 본인 데이터만). */
export async function competitorsApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path}=new URL(request.url),method=request.method;
 const input=()=>body(request,anyJson);
 if(path==='/api/competitors'){
  if(method==='GET')return json({data:listCompetitors(db,user.id)});
  if(method==='POST'){rateLimit(db,`competitor-write:${user.id}`,60,15*60_000);return json({data:addCompetitor(db,user.id,await input())},201);}
 }
 const one=path.match(new RegExp(`^/api/competitors/${ID}$`));
 if(one){
  if(method==='PATCH')return json({data:updateCompetitor(db,user.id,one[1],await input())});
  if(method==='DELETE')return json({data:deleteCompetitor(db,user.id,one[1],await input())});
 }
 const refresh=path.match(new RegExp(`^/api/competitors/${ID}/refresh$`));
 if(refresh&&method==='POST')return json({data:await refreshCompetitor(db,user.id,refresh[1])});
 if(path==='/api/actions'&&method==='GET')return json({data:listActionItems(db,user.id)});
 const action=path.match(new RegExp(`^/api/actions/${ID}$`));
 if(action&&method==='PATCH')return json({data:updateActionItem(db,user.id,action[1],await input())});
 return null;
}
