import {z} from 'zod';
import type {Database} from '../database';
import {requireAdmin,type User} from '../auth';
import {body,json,rateLimit} from '../http';
import {addKeywordMetric,createKeyword,deleteKeyword,deleteKeywordMetric,getAdminKeyword,listAdminKeywords,updateKeyword} from './admin-keywords';
import {collectKeywordMetrics} from './collect';
import {createMemberKeyword,updateMemberKeyword,deleteMemberKeyword,keywordSuggestions,measureMemberKeyword} from './member-keywords';
import {listRecommendations,setKeywordState} from './recommendations';
import {getRecommendationFeed,refreshRecommendationFeed,updateRecommendation,loadRecommendationCompetition} from './discovery-feed';

const ID='([a-f0-9-]{36})';
const anyJson=z.unknown();

/** 관리자 키워드·지표 CRUD와 회원 추천 조회·작성 완료 표시. 해당 경로가 아니면 null. */
export async function keywordsApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path,searchParams}=new URL(request.url),method=request.method;
 const input=()=>body(request,anyJson);
 if(path==='/api/recommendations/feed'&&method==='GET')return json({data:getRecommendationFeed(db,user.id,Object.fromEntries(searchParams))});
 if(path==='/api/recommendations/refresh'&&method==='POST'){
  rateLimit(db,`recommendation-refresh:${user.id}`,12,3600000);
  return json({data:await refreshRecommendationFeed(db,user.id,await input())});
 }
 const feedItem=path.match(new RegExp(`^/api/recommendations/feed/${ID}$`));
 if(feedItem&&method==='PATCH'){
  rateLimit(db,`recommendation-state:${user.id}`,300,15*60000);
  return json({data:updateRecommendation(db,user.id,feedItem[1],await input())});
 }
 const competition=path.match(new RegExp(`^/api/recommendations/feed/${ID}/competition$`));
 if(competition&&method==='POST'){
  return json({data:await loadRecommendationCompetition(db,user.id,competition[1],await input())});
 }
 if(path==='/api/recommendations'&&method==='GET')return json(listRecommendations(db,user.id,Object.fromEntries(searchParams)));
 if(path==='/api/recommendations'&&method==='POST'){rateLimit(db,`member-keyword-create:${user.id}`,100,3600000);return json({data:createMemberKeyword(db,user.id,await input())},201);}
 if(path==='/api/recommendations/suggestions'&&method==='GET')return json({data:keywordSuggestions(db,user.id)});
 const member=path.match(new RegExp(`^/api/recommendations/${ID}$`));
 if(member){
  if(method==='PATCH')return json({data:updateMemberKeyword(db,user.id,member[1],await input())});
  if(method==='DELETE')return json({data:deleteMemberKeyword(db,user.id,member[1],await input())});
 }
 const measure=path.match(new RegExp(`^/api/recommendations/${ID}/metrics$`));
 if(measure&&method==='POST')return json({data:await measureMemberKeyword(db,user.id,measure[1],await input())});
 const state=path.match(new RegExp(`^/api/recommendations/${ID}/state$`));
 if(state&&method==='PUT'){rateLimit(db,`keyword-state:${user.id}`,300,15*60_000);return json({data:setKeywordState(db,user.id,state[1],await input())});}
 if(!path.startsWith('/api/admin/keywords'))return null;
 requireAdmin(user);
 if(path==='/api/admin/keywords/metrics-collect'&&method==='POST')return json({data:await collectKeywordMetrics(db,user.id,await input())});
 if(path==='/api/admin/keywords'){
  if(method==='GET')return json(listAdminKeywords(db,user.id,Object.fromEntries(searchParams)));
  if(method==='POST')return json({data:createKeyword(db,user.id,await input())},201);
 }
 const one=path.match(new RegExp(`^/api/admin/keywords/${ID}$`));
 if(one){
  if(method==='GET')return json({data:getAdminKeyword(db,user.id,one[1])});
  if(method==='PATCH')return json({data:updateKeyword(db,user.id,one[1],await input())});
  if(method==='DELETE')return json({data:deleteKeyword(db,user.id,one[1],await input())});
 }
 const metrics=path.match(new RegExp(`^/api/admin/keywords/${ID}/metrics$`));
 if(metrics&&method==='POST')return json({data:addKeywordMetric(db,user.id,metrics[1],await input())},201);
 const metric=path.match(new RegExp(`^/api/admin/keywords/${ID}/metrics/${ID}$`));
 if(metric&&method==='DELETE')return json({data:deleteKeywordMetric(db,user.id,metric[1],metric[2])});
 return null;
}
