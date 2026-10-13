import type {CapturedPageData} from '../../types/site';
import {database,type Database} from '../database';
import {appOrigin} from '../http';
import {getPublishedArticle} from './articles';
import {blogArticleRoute,buildArticlePage,buildBlogIndexPage} from './blog-pages';
import {applySeeds} from './seed';

let seeded=false;
/** 콘텐츠 화면은 첫 접근 때 캡처 기사 시드를 한 번 적용한 DB를 쓴다(이미 적용됐으면 조회 1회로 끝). */
export function contentDatabase():Database{
 const db=database();
 if(!seeded){applySeeds(db);seeded=true;}
 return db;
}

/**
 * DB가 담당하는 블로그 경로를 렌더링한다.
 * undefined: 블로그 경로가 아님, null: 블로그 경로지만 공개 글이 없음(404), 그 외: 화면 데이터.
 */
export async function resolveBlogPage(path:string):Promise<CapturedPageData|null|undefined>{
 if(path==='/blog')return buildBlogIndexPage(contentDatabase());
 if(!path.startsWith('/blog/'))return undefined;
 const route=blogArticleRoute(path);
 if(!route)return null;
 const db=contentDatabase();
 const article=getPublishedArticle(db,route.category,route.slug);
 return article?buildArticlePage(db,article,{origin:appOrigin()}):null;
}
