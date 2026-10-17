import {getCapturedPage} from '../../lib/pages';
import type {CapturedPageData} from '../../types/site';
import type {Database} from '../database';
import {mapTree,withChildren} from '../content/tree';
import {listRecommendations,recommendationQuery} from './recommendations';
import {keywordSuggestions} from './member-keywords';
import {searchAdConfig} from './searchad';

/** 회원 전용 키워드 작업 공간. 캡처의 예시 키워드·수치·이벤트 배너는 남기지 않는다. */
export async function buildRecommendationsPage(db:Database,userId:string,params:Record<string,string|undefined>,now=Date.now()):Promise<CapturedPageData>{
 const tpl=await getCapturedPage('/dashboard/recommendations');
 if(!tpl)throw new Error('recommendations template missing');
 const parsed=recommendationQuery.safeParse({...params,pageSize:25});
 const query=parsed.success?parsed.data:recommendationQuery.parse({pageSize:25});
 const list=listRecommendations(db,userId,query,now);
 const body=mapTree(tpl.body,n=>n.tag==='main'?[withChildren(n,[{tag:'div',attrs:{'data-naeo-slot':'keyword-workspace'},children:[]}])]:undefined);
 return{...tpl,body,source:'database',recommendations:{list,suggestions:keywordSuggestions(db,userId),metricsConfigured:!!searchAdConfig()}};
}
