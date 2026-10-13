import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {parseRss,rssUrl,fetchRss,collectBlog,MAX_RSS_BYTES} from '../../src/server/collect/rss';

const item=(n:number,over:Partial<Record<'title'|'link'|'description'|'category'|'tag'|'pubDate'|'guid',string>>={})=>`<item>
 <author>tester</author><category>${over.category??'일상'}</category>
 <title><![CDATA[${over.title??`테스트 글 ${n}`}]]></title>
 <link>${over.link??`https://blog.naver.com/qa_blog/2230000000${n}?fromRss=true&amp;trackingCode=rss`}</link>
 <guid>${over.guid??`https://blog.naver.com/qa_blog/2230000000${n}`}</guid>
 <description><![CDATA[${over.description??`<p>본문 &amp; <b>요약</b> ${n}</p><img src="x.png">`}]]></description>
 <tag><![CDATA[${over.tag??'여행,맛집'}]]></tag>
 <pubDate>${over.pubDate??`Mon, 0${n} Sep 2026 10:00:00 +0900`}</pubDate>
</item>`;
const feed=(items:string)=>`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title><![CDATA[QA 블로그]]></title><link>https://blog.naver.com/qa_blog</link>${items}</channel></rss>`;
const response=(body:string,init:ResponseInit={status:200,headers:{'content-type':'text/xml;charset=UTF-8'}})=>new Response(body,init);

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const owner=(await register(db,{email:'rss@example.test',password:'rss-long-password',nickname:'수집',termsAccepted:true})).user;
 const blog=createBlog(db,owner.id,{naverId:'qa_blog',title:'QA',category:'',isPrimary:true});
 return{db,blog};
}

test('only the fixed Naver RSS host is ever requested',()=>{
 assert.equal(rssUrl('qa_blog'),'https://rss.blog.naver.com/qa_blog.xml');
 for(const bad of ['../etc','a b','x.y','http://evil','qa_blog/..','','A'.repeat(60)])assert.throws(()=>rssUrl(bad),{code:'INVALID_BLOG_ID'},bad);
});

test('parser reads Naver RSS items: canonical URL, plain-text excerpt, tags, dates',()=>{
 const parsed=parseRss(feed(item(1)+item(2)),'qa_blog');
 assert.equal(parsed.title,'QA 블로그');
 assert.equal(parsed.items.length,2);
 const first=parsed.items[0];
 assert.equal(first.externalId,'22300000001');
 assert.equal(first.url,'https://blog.naver.com/qa_blog/22300000001','tracking query removed');
 assert.equal(first.title,'테스트 글 1');
 assert.equal(first.excerpt,'본문 & 요약 1','HTML stripped, entities decoded');
 assert.deepEqual(first.tags,['여행','맛집']);assert.equal(first.category,'일상');
 assert.equal(first.publishedAt,Date.parse('2026-09-01T01:00:00Z'));
});

test('parser ignores items pointing outside the blog and caps field sizes',()=>{
 const parsed=parseRss(feed(item(1,{link:'https://evil.example/1',guid:'https://evil.example/1'})+item(2,{description:'가'.repeat(5000),title:'제'.repeat(400)})),'qa_blog');
 assert.equal(parsed.items.length,1);
 assert.equal(parsed.items[0].excerpt.length,2000);assert.equal(parsed.items[0].title.length,300);
});

test('fetch errors are classified: missing blog is permanent, server errors retry, redirects and huge bodies are refused',async()=>{
 const empty=`<?xml version="1.0"?><rss version="2.0"><channel><title/></channel></rss>`;
 await assert.rejects(fetchRss('qa_blog',async()=>response(empty)),{code:'BLOG_NOT_FOUND',retryable:false});
 await assert.rejects(fetchRss('qa_blog',async()=>response('x',{status:404})),{code:'BLOG_NOT_FOUND',retryable:false});
 await assert.rejects(fetchRss('qa_blog',async()=>response('x',{status:503})),{code:'FETCH_FAILED',retryable:true});
 await assert.rejects(fetchRss('qa_blog',async()=>response('',{status:302,headers:{location:'http://169.254.169.254/'}})),{code:'FETCH_FAILED'});
 await assert.rejects(fetchRss('qa_blog',async()=>{throw new TypeError('network');}),{code:'FETCH_FAILED',retryable:true});
 await assert.rejects(fetchRss('qa_blog',async()=>response('<rss>'+'x'.repeat(MAX_RSS_BYTES+10)+'</rss>')),{code:'RSS_TOO_LARGE',retryable:false});
 let requested='';let redirect:RequestRedirect|undefined;
 await fetchRss('qa_blog',async(url,init)=>{requested=String(url);redirect=init?.redirect;return response(feed(item(1)));});
 assert.equal(requested,'https://rss.blog.naver.com/qa_blog.xml');assert.equal(redirect,'manual');
});

test('collectBlog upserts posts with source and collection time, keeping one row per post',async t=>{
 const {db,blog}=await fixture(t);
 const first=await collectBlog(db,blog.id,async()=>response(feed(item(1)+item(2))),1000);
 assert.deepEqual(first,{fetched:2,inserted:2,updated:0,blogTitle:'QA 블로그'});
 const second=await collectBlog(db,blog.id,async()=>response(feed(item(1,{title:'고친 제목'})+item(3))),2000);
 assert.deepEqual(second,{fetched:2,inserted:1,updated:1,blogTitle:'QA 블로그'});
 const rows=db.prepare('SELECT external_id,title,collected_at FROM blog_posts WHERE blog_id=? ORDER BY external_id').all(blog.id) as {external_id:string;title:string;collected_at:number}[];
 assert.equal(rows.length,3);
 assert.equal(rows[0].title,'고친 제목');assert.equal(rows[0].collected_at,2000);
 assert.equal(rows[1].collected_at,1000,'posts missing from the latest feed are kept');
});
