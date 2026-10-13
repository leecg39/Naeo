import type {MetadataRoute} from 'next';
import type {Database} from '../database';
import {listPublishedArticles} from './articles';
import {DOCUMENT_SELECT,toDocument,type DocumentRow} from './documents';
import {listPublishedUpdates} from './updates';

/** 캡처 화면 중 검색 노출 대상인 공개 화면(대시보드·관리자·로그인·미리보기·내보내기 화면 제외). */
const STATIC_PUBLIC=['/','/blog','/faq','/updates','/contact','/pricing','/ranking','/event','/event/naeo-review','/event/ranking-reward','/mate','/mcp'];
type Entry={url:string;lastModified?:Date};

function publishedDocuments(db:Database){
 return (db.prepare(`${DOCUMENT_SELECT} WHERE status='published' ORDER BY position,path`).all() as DocumentRow[]).map(toDocument);
}
function visiblePages(db:Database){
 return db.prepare("SELECT path,title,updated_at AS updatedAt FROM page_settings WHERE status='published' ORDER BY path").all() as {path:string;title:string;updatedAt:number}[];
}

/** 공개 상태이고 이미 게시된 콘텐츠만 넣는다(초안·예약·숨김·삭제·예전 /updates/:slug 주소 제외). */
export function sitemapEntries(db:Database,origin:string,now=Date.now()):Entry[]{
 const articles=listPublishedArticles(db,{now});
 const updates=listPublishedUpdates(db);
 const latest=(ms:number[])=>ms.length?new Date(Math.max(...ms)):undefined;
 const special:Record<string,Date|undefined>={'/blog':latest(articles.map(a=>a.updatedAt)),'/updates':latest(updates.map(u=>u.updatedAt))};
 const entries:Entry[]=[
  ...STATIC_PUBLIC.map(p=>({url:origin+p,...(special[p]?{lastModified:special[p]}:{})})),
  ...visiblePages(db).map(p=>({url:origin+p.path,lastModified:new Date(p.updatedAt)})),
  ...publishedDocuments(db).map(d=>({url:origin+d.path,lastModified:new Date(d.updatedAt)})),
  ...articles.map(a=>({url:origin+a.url,lastModified:new Date(a.updatedAt)}))
 ];
 return entries.filter((e,i)=>entries.findIndex(x=>x.url===e.url)===i);
}

const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]!);
/** XML 1.0에서 허용하지 않는 제어 문자를 지운다. */
const allowed=(c:string)=>{const n=c.charCodeAt(0);return n>=0x20||n===0x09||n===0x0A||n===0x0D;};
const clean=(s:string)=>[...s].filter(allowed).join('');
const text=(s:string)=>xml(clean(s));

/** 매거진 최신 공개 글 20개의 RSS 2.0 피드. */
export function rssXml(db:Database,origin:string,now=Date.now()):string{
 const articles=listPublishedArticles(db,{now}).slice(0,20);
 const items=articles.map(a=>[
  '<item>',`<title>${text(a.title)}</title>`,`<link>${text(origin+a.url)}</link>`,`<guid isPermaLink="true">${text(origin+a.url)}</guid>`,
  `<pubDate>${new Date(a.publishedAt!).toUTCString()}</pubDate>`,`<category>${text(a.category.name)}</category>`,`<description>${text(a.summary)}</description>`,'</item>'
 ].join(''));
 return['<?xml version="1.0" encoding="UTF-8"?>','<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>',
  `<title>NAEO 매거진</title><link>${text(origin+'/blog')}</link><description>네이버 블로그 AI 브리핑과 검색 노출에 관한 NAEO 매거진 글</description><language>ko</language>`,
  `<atom:link href="${text(origin+'/rss.xml')}" rel="self" type="application/rss+xml"/>`,
  ...(articles[0]?[`<lastBuildDate>${new Date(Math.max(...articles.map(a=>a.updatedAt))).toUTCString()}</lastBuildDate>`]:[]),
  ...items,'</channel></rss>',''].join('\n');
}

/** 마크다운 링크 글자에서 링크 문법을 깨는 문자를 막는다. */
const md=(s:string)=>clean(s).replace(/[[\]\\]/g,c=>'\\'+c).replace(/\s+/g,' ').trim();

/** AI 도구가 사이트 구조를 파악하도록 공개 콘텐츠를 절대 주소로 정리한 llms.txt. */
export function llmsTxt(db:Database,origin:string,now=Date.now()):string{
 const link=(title:string,path:string,note='')=>`- [${md(title)}](${origin}${path})${note?': '+md(note):''}`;
 const articles=listPublishedArticles(db,{now});
 return[
  '# NAEO','',
  '> 네이버 블로그 글이 AI 브리핑에 인용될 수 있도록 진단·키워드 추천·글쓰기를 돕는 서비스의 공개 안내 색인입니다.','',
  '## 안내','',
  link('첫 화면','/'),link('자주 묻는 질문','/faq'),link('업데이트 소식','/updates'),link('요금제','/pricing'),link('문의','/contact'),
  ...visiblePages(db).map(p=>link(p.title,p.path)),'',
  '## 매거진','',
  ...articles.map(a=>link(a.title,a.url,a.summary)),'',
  '## 정책','',
  ...publishedDocuments(db).map(d=>link(d.title,d.path)),''
 ].join('\n');
}

/** 기본은 전체 차단(복제 사이트가 원본 대신 검색되지 않도록). NAEO_ALLOW_INDEXING=1일 때만 공개 화면을 허용한다. */
export function robotsRules(origin:string,allowIndexing:boolean):MetadataRoute.Robots{
 if(!allowIndexing)return{rules:{userAgent:'*',disallow:'/'}};
 return{rules:{userAgent:'*',allow:'/',disallow:['/admin/','/api/','/dashboard/','/dashboard','/login','/auth/','/oauth/','/payment/','/dev/','/preview','/social/','/p/']},sitemap:`${origin}/sitemap.xml`};
}
