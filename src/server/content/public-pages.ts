import type {CapturedPageData} from '../../types/site';
import {database,type Database} from '../database';
import {appOrigin} from '../http';
import {getPublishedArticle} from './articles';
import {blogArticleRoute,buildArticlePage,buildBlogIndexPage} from './blog-pages';
import {applyPageSettingSeeds,applySeeds} from './seed';
import {resolveManagedPage} from './page-settings';
import {documentRouteState,getPublishedDocument} from './documents';
import {buildDocumentPage} from './document-pages';
import {listPublishedFaq} from './faq';
import {buildFaqPage} from './faq-pages';
import {listPublishedUpdates} from './updates';
import {buildUpdatesPage} from './updates-pages';

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

/** 고정 디자인 페이지 설정 시드(캡처 파일 읽기)까지 적용한 DB. */
export async function pageSettingsDatabase():Promise<Database>{
 const db=contentDatabase();
 await applyPageSettingSeeds(db);
 return db;
}

/** DB 정책 문서 경로를 렌더링한다. undefined: 문서 경로 아님, null: 비공개·삭제(404). */
export async function resolveDocumentPage(path:string):Promise<CapturedPageData|null|undefined>{
 const db=contentDatabase();
 const state=documentRouteState(db,path);
 if(state==='none')return undefined;
 const doc=state==='published'?getPublishedDocument(db,path):null;
 return doc?buildDocumentPage(doc):null;
}

/** DB가 맡는 화면을 순서대로 찾는다(블로그 → FAQ → 업데이트 → 고정 디자인 페이지 → 정책 문서). undefined면 캡처 화면으로 넘긴다. */
export async function resolveDatabasePage(path:string):Promise<CapturedPageData|null|undefined>{
 const blog=await resolveBlogPage(path);
 if(blog!==undefined)return blog;
 if(path==='/faq')return buildFaqPage(listPublishedFaq(contentDatabase()));
 if(path==='/updates')return buildUpdatesPage(listPublishedUpdates(contentDatabase()));
 const managed=await resolveManagedPage(await pageSettingsDatabase(),path);
 if(managed!==undefined)return managed;
 return resolveDocumentPage(path);
}
