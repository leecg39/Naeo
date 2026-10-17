import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {buildAiPicksPage} from '../../src/server/analysis/ai-picks-page';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {citationDetail,enqueueCitation} from '../../src/server/citations/runs';
import {runCitationOnce} from '../../src/server/citations/worker';
import type {CitationConfig} from '../../src/server/citations/provider';
import type {CapturedNode,CapturedPageData} from '../../src/types/site';

type El=Exclude<CapturedNode,string>;
const all=(nodes:CapturedNode[],f:(n:El)=>boolean,out:El[]=[]):El[]=>{for(const n of nodes){if(typeof n==='string')continue;if(f(n))out.push(n);all(n.children,f,out);}return out;};
const text=(n:CapturedNode):string=>typeof n==='string'?n:n.children.map(text).join('');
const has=(c:string)=>(n:El)=>(n.attrs.class??'').split(/\s+/).includes(c);
const index=JSON.parse(readFileSync('src/data/page-index.json','utf8')) as Record<string,string>;
const captured=JSON.parse(readFileSync('src/data/pages/'+index['/dashboard/ai-picks'],'utf8')) as CapturedPageData;
async function member(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const id=(await register(db,{email:'picks@example.test',password:'ai-picks-page-password',nickname:'인용 화면',termsAccepted:true})).user.id;
 return{db,id};
}
function withConfig(t:TestContext){
 const saved={provider:process.env.NAEO_CITATION_PROVIDER,key:process.env.NAEO_SERPAPI_KEY};
 process.env.NAEO_CITATION_PROVIDER='serpapi';process.env.NAEO_SERPAPI_KEY='p'.repeat(40);
 t.after(()=>{for(const [k,v] of [['NAEO_CITATION_PROVIDER',saved.provider],['NAEO_SERPAPI_KEY',saved.key]] as const){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
}

test('AI picks page shows an honest not-configured state without the captured account data',async t=>{
 const {db,id}=await member(t);
 const page=await buildAiPicksPage(db,id);
 const capturedRows=all(captured.body,has('mui-uien4a'))[0].children.length;
 assert.ok(capturedRows>10,'capture had rows');
 assert.equal(all(page.body,has('mui-uien4a'))[0].children.filter(c=>typeof c!=='string').length,1,'only the empty-state row');
 assert.match(text(all(page.body,has('mui-uien4a'))[0]),/미설정/);
 const metrics=all(page.body,n=>n.attrs['aria-label']==='AI 인용 현황 핵심 지표')[0];
 assert.ok(!/\d/.test(text(metrics)),'no captured metric numbers');
 assert.match(text(all(page.body,has('mui-1ptiu1r'))[0]),/설정되지 않았/);
 const tabs=all(page.body,has('mui-d7s6pe'))[0];
 assert.ok(!/[1-9]/.test(text(tabs)),'filter counts are zero');
 assert.ok(!/[1-9]/.test(text(all(page.body,has('mui-1aa9dm1'))[0])),'no captured distribution numbers');
 assert.ok(!/커피 한 잔|naeo_blog|병역특례/.test(text({tag:'root',attrs:{},children:page.body})),'no captured promotion or account content');
 const run=all(page.body,n=>'data-citation-blog' in n.attrs)[0];
 assert.equal(run.attrs.disabled,'','the check button is disabled without a provider');
});

test('AI picks page renders the latest successful check of the member own blog',async t=>{
 withConfig(t);
 const {db,id}=await member(t),now=Date.UTC(2026,9,16,3);
 const blog=createBlog(db,id,{naverId:'picks_blog',title:'인용 화면 블로그',category:'',isPrimary:true}).id;
 const post=(logNo:string,title:string,tags:string[],category:string)=>db.prepare('INSERT INTO blog_posts(id,blog_id,external_id,url,title,excerpt,category,tags_json,published_at,collected_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),blog,logNo,`https://blog.naver.com/picks_blog/${logNo}`,title,'',category,JSON.stringify(tags),now-Number(logNo)*86_400_000,now);
 post('1','제주 여행 코스 정리',['제주 여행','제주 렌트카','제주 숙소'],'여행');post('2','부산 맛집 정리',['부산 맛집'],'맛집');post('3','서울 카페',['서울 카페'],'');
 const kw1=randomUUID(),kw2=randomUUID(),kw3=randomUUID();
 db.prepare("INSERT INTO keywords(id,phrase,category,status,note,version,created_at,updated_at) VALUES(?,'제주 여행','여행','active','',1,?,?)").run(kw1,now,now);
 db.prepare("INSERT INTO keyword_metrics(id,keyword_id,pc_volume,mobile_volume,document_count,source,measured_at,created_at) VALUES(?,?,400,1600,500,'manual',?,?)").run(randomUUID(),kw1,now,now);
 db.prepare("INSERT INTO keywords(id,phrase,category,status,note,version,created_at,updated_at) VALUES(?,'제주 렌트카','여행','active','',1,?,?)").run(kw2,now,now);
 db.prepare("INSERT INTO keyword_metrics(id,keyword_id,pc_volume,mobile_volume,document_count,source,measured_at,created_at) VALUES(?,?,200,800,1500,'manual',?,?)").run(randomUUID(),kw2,now,now);
 db.prepare("INSERT INTO keywords(id,phrase,category,status,note,version,created_at,updated_at) VALUES(?,'제주 항공권','여행','active','',1,?,?)").run(kw3,now,now);
 db.prepare("INSERT INTO keyword_metrics(id,keyword_id,pc_volume,mobile_volume,document_count,source,measured_at,created_at) VALUES(?,?,500,2500,900,'manual',?,?)").run(randomUUID(),kw3,now,now);
 const config:CitationConfig={provider:'serpapi',apiKey:'p'.repeat(40),base:'http://127.0.0.1:9',device:'desktop'};
 enqueueCitation(db,id,{blogId:blog},{source:'member',config},now);
 await runCitationOnce(db,'w',async keyword=>({searches:1,links:keyword==='부산 맛집'?[{link:'https://blog.naver.com/picks_blog/2',section:'blog_results',position:1}]:[],
  briefing:keyword==='서울 카페'?null:{markdown:'제주 여행 요약 [3]',references:keyword==='제주 여행'?[{index:3,title:'내 글',link:'https://m.blog.naver.com/picks_blog/1',source:'블로그',snippet:'문장 요약'}]:[],media:[],questions:['제주 3박 4일 코스는?']}}),()=>now);
 const page=await buildAiPicksPage(db,id,now+3600_000);
 assert.match(page.css,/html\.light \[data-naeo-captured-root="\/dashboard\/ai-picks"\]/);
 const headerHelp=all(page.body,n=>n.tag==='button'&&n.attrs['aria-label']==='AI 성과 설명');
 assert.equal(headerHelp.length,1,'column header help button has aria-label');
 const rows=all(page.body,n=>!!n.attrs['data-result-id']&&has('MuiBox-root')(n)&&n.tag==='div'&&!!n.attrs['data-post-id']);
 assert.equal(rows.length,3);
 const byKeyword=Object.fromEntries(rows.map(r=>[r.attrs['data-keyword'],r]));
 assert.match(text(byKeyword['제주 여행']),/제주 여행 코스 정리/);assert.match(text(byKeyword['제주 여행']),/본문 3위/);assert.ok(has('mui-5nlkae')(byKeyword['제주 여행']),'cited row style');
 assert.equal(byKeyword['제주 여행'].attrs['data-text-cited'],'true');
 assert.equal(all([byKeyword['제주 여행']],has('naeo-post-category')).map(text)[0],'여행');
 assert.ok(all([byKeyword['제주 여행']],n=>n.tag==='span'&&(n.attrs.style??'').includes('#03c75a')).length===1,'low saturation (<0.5) is highlighted in green');
 assert.match(text(byKeyword['부산 맛집']),/O/);assert.match(text(byKeyword['부산 맛집']),/미추천/);assert.ok(has('mui-q6fgsd')(byKeyword['부산 맛집']),'exposed row style');
 assert.equal(byKeyword['서울 카페'].attrs['data-category'],'미분류');assert.match(text(byKeyword['서울 카페']),/-/);
 assert.ok(all([byKeyword['제주 여행']],n=>n.tag==='a')[0].attrs.href==='https://blog.naver.com/picks_blog/1');
 const detail=citationDetail(db,id,byKeyword['제주 여행'].attrs['data-result-id']!);
 assert.equal(detail.textCitedCount,1);assert.equal(detail.samePostCitedCount,1);
 assert.deepEqual(detail.mainKeywordMetric,{keyword:'제주 여행',pcVolume:400,mobileVolume:1600,total:2000,compIdx:'낮음',documentCount:500,saturation:0.25});
 assert.deepEqual(detail.subKeywords.map(k=>[k.keyword,k.total,k.compIdx]),[['제주 렌트카',1000,'보통'],['제주 숙소',null,null]]);
 assert.deepEqual(detail.relatedKeywords.map(k=>[k.keyword,k.total]),[['제주 항공권',3000],['제주 렌트카',1000]]);
 const metrics=text(all(page.body,n=>n.attrs['aria-label']==='AI 인용 현황 핵심 지표')[0]);
 assert.match(metrics,/전체 글3/);assert.match(metrics,/AI 추천1\/ 3/);assert.match(metrics,/AI 브리핑 노출2/);assert.match(metrics,/AI 추천률33%/);
 assert.deepEqual(all(page.body,has('mui-5vm3uw'))[0].children.filter((c):c is El=>typeof c!=='string'&&c.tag==='button').map(text),['전체 3','통합검색 노출 1','AI 브리핑 2','AI 추천됨 1']);
 assert.deepEqual(all(page.body,has('mui-x14t34')).map(r=>text(r.children.find((c):c is El=>typeof c!=='string')!)),['맛집','미분류','여행']);
 assert.match(text(all(page.body,has('mui-1ptiu1r'))[0]),/마지막 확인: \d{2}-\d{2} \d{2}:\d{2} \(1시간 전\)/);
 const run=all(page.body,n=>'data-citation-blog' in n.attrs)[0];
 assert.equal(run.attrs['data-citation-blog'],blog);assert.equal(run.attrs.disabled,undefined);assert.match(text(run),/인용 다시 확인/);
 assert.ok(!/naeo_blog|병역특례|커피 한 잔/.test(text({tag:'root',attrs:{},children:page.body})));
});
