import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../../src/server/database';
import {applySeeds} from '../../src/server/content/seed';
import {getPublishedArticle,listPublishedArticles} from '../../src/server/content/articles';
import {buildArticlePage,buildBlogIndexPage,isTrackingPixel} from '../../src/server/content/blog-pages';
import {textOf,find} from '../../src/server/content/tree';
import type {CapturedNode,CapturedPageData} from '../../src/types/site';

const ORIGIN='https://www.naeo.kr';
const index=JSON.parse(readFileSync('src/data/page-index.json','utf8')) as Record<string,string>;
/** 캡처 시점 광고·분석 추적 픽셀(숨김 1×1)은 페이지 내용이 아니므로 비교에서 뺀다. */
const captured=(route:string)=>{const p=JSON.parse(readFileSync('src/data/pages/'+index[route],'utf8')) as CapturedPageData;return{...p,body:p.body.filter(n=>!isTrackingPixel(n))};};
function fixture(t:TestContext){const db=openDatabase(':memory:');t.after(()=>db.close());applySeeds(db);return db;}

/**
 * 로딩 상태 클래스, style 표기, 속성 순서, 인접 텍스트 분할, JS가 계산한 목차 위치와
 * 캡처 시점 스크롤에 따른 목차 활성 클래스(mui-1dsm7pu, 실행 중 scroll-spy가 갱신)만 무시한다.
 */
function normalize(nodes:CapturedNode[],inToc=false):CapturedNode[]{
 const out:CapturedNode[]=[];
 for(const n of nodes){
  if(typeof n==='string'){if(typeof out.at(-1)==='string')out[out.length-1]+=n;else out.push(n);continue;}
  // data-category는 분류 탭 필터를 위해 의도적으로 추가한 속성이다.
  const attrs=Object.fromEntries(Object.entries(n.attrs).filter(([k])=>k!=='data-category'&&!(k==='style'&&n.attrs['aria-label']==='목차')).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>{
   if(k==='class')return[k,v.split(/\s+/).filter(c=>c&&c!=='loaded').map(c=>inToc&&c==='mui-1dsm7pu'?'mui-h98nsl':c).join(' ')];
   if(k==='style')return[k,v.replace(/\s+/g,'').replace(/;$/,'')];
   return[k,v];
  }));
  out.push({tag:n.tag,attrs,children:normalize(n.children,inToc||n.attrs['aria-label']==='목차')});
 }
 return out;
}
function firstDiff(a:unknown,b:unknown):string{
 const A=JSON.stringify(a),B=JSON.stringify(b);let i=0;while(i<A.length&&A[i]===B[i])i++;
 return `\n built:    ${A.slice(Math.max(0,i-160),i+160)}\n captured: ${B.slice(Math.max(0,i-160),i+160)}`;
}

test('every seeded article page is rebuilt from the database identically to the capture',async t=>{
 const db=fixture(t);
 const articles=listPublishedArticles(db,{});
 assert.equal(articles.length,20);
 for(const a of articles){
  const built=await buildArticlePage(db,a,{origin:ORIGIN});
  const want=captured(a.url);
  assert.equal(built.title,want.title,a.url);
  const [x,y]=[normalize(built.body),normalize(want.body)];
  assert.ok(JSON.stringify(x)===JSON.stringify(y),a.url+firstDiff(x,y));
 }
});

test('blog index is rebuilt from the database identically to the capture',async t=>{
 const db=fixture(t);
 const built=await buildBlogIndexPage(db);
 const [x,y]=[normalize(built.body),normalize(captured('/blog').body)];
 assert.ok(JSON.stringify(x)===JSON.stringify(y),firstDiff(x,y));
});

test('database edits appear on the public pages and drafts disappear from navigation',async t=>{
 const db=fixture(t);
 db.prepare("UPDATE articles SET title='수정된 제목 <script>alert(1)</script>',version=version+1 WHERE slug='golden-keywords'").run();
 db.prepare("UPDATE articles SET status='draft' WHERE slug='what-is-ai-briefing'").run();
 const a=getPublishedArticle(db,'marketing','golden-keywords')!;
 const page=await buildArticlePage(db,a,{origin:ORIGIN});
 assert.equal(textOf(find(page.body,n=>n.tag==='h1')!),'수정된 제목 <script>alert(1)</script>');
 assert.equal(JSON.stringify(page.body).includes('"tag":"script"'),false);
 assert.equal(JSON.stringify(page.body).includes('/blog/marketing/what-is-ai-briefing'),false);
 const idx=await buildBlogIndexPage(db);
 assert.ok(JSON.stringify(idx.body).includes('수정된 제목'));
 assert.equal(JSON.stringify(idx.body).includes('what-is-ai-briefing'),false);
 assert.ok(JSON.stringify(idx.body).includes('전체 (19)'));
});

test('share links use the configured origin and encode the title',async t=>{
 const db=fixture(t);
 const a=getPublishedArticle(db,'marketing','golden-keywords')!;
 const page=await buildArticlePage(db,a,{origin:'http://127.0.0.1:3000'});
 const x=find(page.body,n=>n.attrs['aria-label']==='X에 공유')!;
 assert.equal(x.attrs.href,`https://twitter.com/intent/tweet?text=${encodeURIComponent(a.title)}&url=${encodeURIComponent('http://127.0.0.1:3000/blog/marketing/golden-keywords')}`);
});

test('draft previews render without previous/next links to other articles',async t=>{
 const db=fixture(t);
 db.prepare("UPDATE articles SET status='draft' WHERE slug='golden-keywords'").run();
 const id=(db.prepare("SELECT id FROM articles WHERE slug='golden-keywords'").get() as {id:string}).id;
 const {getAdminArticle}=await import('../../src/server/content/admin-articles');
 const admin=(await import('../../src/server/auth')).register;
 const u=(await admin(db,{email:'p@example.test',password:'preview-long-password',nickname:'p',termsAccepted:true})).user;
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(u.id);
 const page=await buildArticlePage(db,getAdminArticle(db,u.id,id),{origin:ORIGIN});
 const box=find(page.body,n=>(n.attrs.class??'').includes('mui-1o2n272'))!;
 assert.deepEqual(box.children.map(c=>typeof c==='string'?c:c.tag),['div','div']);
});
