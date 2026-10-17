import {getCapturedPage} from '../../lib/pages';
import type {CapturedPageData} from '../../types/site';
import type {Database} from '../database';
import {mapTree,withChildren} from '../content/tree';
import {listRecommendations,recommendationQuery} from './recommendations';
import {keywordSuggestions} from './member-keywords';
import {searchAdConfig} from './searchad';
import {getRecommendationFeed,rebuildLocalRecommendations,recommendationFeedQuery} from './discovery-feed';

/** 회원 전용 키워드 작업 공간. 캡처의 예시 키워드·수치·이벤트 배너는 남기지 않는다. */
export async function buildRecommendationsPage(db:Database,userId:string,params:Record<string,string|undefined>,now=Date.now()):Promise<CapturedPageData>{
 const tpl=await getCapturedPage('/dashboard/recommendations');
 if(!tpl)throw new Error('recommendations template missing');
 // 블로그 선택은 ?blog=<naver_id>(대시보드와 같은 규칙) 또는 ?blogId=<블로그 id>를 받는다.
 // 본인 소유로 확인되지 않는 값은 무시하고 대표 블로그로 되돌아간다(API의 엄격한 404와 달리 페이지는 깨지지 않는다).
 const requested=params.blog??params.blogId;
 const resolved=requested?(db.prepare('SELECT id FROM blogs WHERE owner_id=? AND (id=? OR naver_id=?)').get(userId,requested,requested) as {id:string}|undefined)?.id:undefined;
 const parsed=recommendationQuery.safeParse({...params,pageSize:25});
 const query=parsed.success?parsed.data:recommendationQuery.parse({pageSize:25});
 const parsedFeed=recommendationFeedQuery.safeParse({...params,blogId:resolved??''});
 const feedQuery=parsedFeed.success?parsedFeed.data:recommendationFeedQuery.parse({});
 const before=getRecommendationFeed(db,userId,feedQuery,now);
 if(before.selectedBlogId){
  try{rebuildLocalRecommendations(db,userId,before.selectedBlogId,now);}catch{/* Feed refresh can retry without blocking the page. */}
 }
 const recommendationFeed=getRecommendationFeed(db,userId,feedQuery,now);
 const list=listRecommendations(db,userId,query,now);
 const body=mapTree(tpl.body,n=>n.tag==='main'?[withChildren(n,[{tag:'div',attrs:{'data-naeo-slot':'keyword-workspace'},children:[]}])]:undefined);
 return{...tpl,body,source:'database',recommendationFeed,recommendationView:params.view==='library'?'library':'recommendations',recommendations:{list,suggestions:keywordSuggestions(db,userId),metricsConfigured:!!searchAdConfig()}};
}
