import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {dashboardData} from '../../src/server/analysis/dashboard-data';
import {dashboardVisualization} from '../../src/server/analysis/dashboard-visualization';
import {dashboardOverview} from '../../src/server/analysis/dashboard-overview';
import {citationOverview} from '../../src/server/citations/runs';
import {analyzePosts} from '../../src/server/analysis/rules';
import {confirmPeriod,periodRange} from '../../src/server/ranking/ranking';
import {createKeyword,addKeywordMetric} from '../../src/server/keywords/admin-keywords';

const NOW=Date.parse('2026-10-17T06:00:00Z'),DAY=86_400_000;
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const user=async(name:string)=>{const id=(await register(db,{email:`${name}@example.test`,password:'dashboard-overview-long',nickname:name,termsAccepted:true})).user.id;return id;};
 const owner=await user('owner'),other=await user('other');
 const blog=createBlog(db,owner,{naverId:'my_blog',title:'내 블로그',category:'여행',isPrimary:true});
 const foreign=createBlog(db,other,{naverId:'foreign_blog',title:'타인 비공개 내용',category:'경제',isPrimary:true});
 return{db,owner,other,blog,foreign,user};
}
function overview(db:Database,owner:string,naverId?:string,now=NOW){
 const data=dashboardData(db,owner,now,naverId),citation=citationOverview(db,owner,{blogId:data.blog?.id??null,config:null,now});
 return dashboardOverview(db,owner,data,citation,dashboardVisualization(db,owner,data,citation));
}
function post(db:Database,blogId:string,title='내 글'){
 const id=randomUUID();db.prepare('INSERT INTO blog_posts(id,blog_id,external_id,url,title,collected_at) VALUES(?,?,?,?,?,?)').run(id,blogId,id,`https://blog.naver.com/my_blog/${id}`,title,NOW-DAY);return id;
}
type Check={post:string;keyword?:string;rank?:number|null;exposed?:number;status?:'checked'|'error';evidence?:unknown;at?:number};
function run(db:Database,owner:string,blogId:string,at:number,checks:Check[],state='succeeded'){
 const id=randomUUID();db.prepare('INSERT INTO citation_runs(id,owner_id,blog_id,state,source,provider,post_limit,run_after,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,blogId,state,'member','test',10,at,at,at,at);
 const ids=checks.map(check=>{const result=randomUUID(),error=check.status==='error';db.prepare(`INSERT INTO citation_results(id,run_id,owner_id,blog_id,post_id,keyword,keyword_source,status,briefing,exposed,text_rank,evidence_json,checked_at) VALUES(?,?,?,?,?,?,'title',?,?,?,?,?,?)`).run(result,id,owner,blogId,check.post,check.keyword??'제주 여행',error?'error':'checked',error?0:check.rank||check.evidence?1:0,error?0:check.exposed??0,error?null:check.rank??null,JSON.stringify(check.evidence??{}),check.at??at);return result;});
 return{id,ids};
}
function scan(db:Database,owner:string,blogId:string,score:number,at:number){
 const id=randomUUID(),report={...analyzePosts([],at),score};db.prepare('INSERT INTO scan_results(id,owner_id,blog_id,score,method_version,report_json,post_count,measured_at) VALUES(?,?,?,?,?,?,?,?)').run(id,owner,blogId,score,report.methodVersion,JSON.stringify(report),0,at);return id;
}
function recommendation(db:Database,owner:string,blogId:string,phrase:string,signal='new',at=NOW-100){
 const id=randomUUID();db.prepare(`INSERT INTO member_recommendations(id,owner_id,blog_id,phrase,phrase_key,signal,reason,source,pc_volume,mobile_volume,document_count,measured_at,recommended_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'blog_analysis',1000,1000,3000,?,?,?,?)`).run(id,owner,blogId,phrase,phrase,signal,'실제 추천',at,at,at,at);return id;
}

test('no measurement differs from checked zero, errors stay unknown, and reads never write',async t=>{
 const {db,owner,blog}=await fixture(t),id=post(db,blog.id);
 assert.deepEqual(overview(db,owner).metrics,{checked:null,cited:null,exposed:null,briefing:null,revisit:0,opportunity:0,recommendations:0});
 run(db,owner,blog.id,NOW-200,[{post:id}]);
 let value=overview(db,owner);assert.equal(value.metrics.checked,1);assert.equal(value.metrics.cited,0);assert.equal(value.metrics.exposed,0);assert.equal(value.metrics.briefing,0);
 run(db,owner,blog.id,NOW-100,[{post:id,status:'error'}]);
 const before=db.prepare('SELECT total_changes() AS n').get()!.n;
 value=overview(db,owner);assert.equal(value.metrics.checked,0);assert.equal(value.metrics.cited,null);assert.equal(value.metrics.exposed,null);assert.deepEqual(value.monitoring,[]);
 assert.equal(db.prepare('SELECT total_changes() AS n').get()!.n,before);
});

test('selected blog, owner, successful runs and timestamps bound all evidence; URLs are sanitized',async t=>{
 const {db,owner,other,blog,foreign}=await fixture(t),mine=post(db,blog.id),theirs=post(db,foreign.id,'타인 비공개 내용');
 const second=createBlog(db,owner,{naverId:'second_blog',title:'다른 내 블로그'}),secondPost=post(db,second.id,'두 번째 글');
 const evidence={briefing:{markdown:'저장된 실제 브리핑',media:[{title:'실제 이미지',link:'https://example.test/source',thumbnail:'https://example.test/thumb'},{title:'잘못된 이미지',link:'javascript:alert(1)',thumbnail:'data:image/svg+xml,test'}],references:[{title:'실제 출처',link:'https://example.test/reference'},{title:'잘못된 출처',link:'javascript:alert(1)'}]}};
 const valid=run(db,owner,blog.id,NOW-300,[{post:mine,rank:2,exposed:1,evidence}]);
 run(db,other,foreign.id,NOW-100,[{post:theirs,rank:1,evidence}]);run(db,owner,second.id,NOW-100,[{post:secondPost}]);
 run(db,owner,blog.id,NOW-200,[{post:mine}],'failed');run(db,owner,blog.id,NOW+100,[{post:mine}]);
 const value=overview(db,owner);assert.equal(value.metrics.cited,1);assert.equal(value.monitoring.length,1);assert.equal(value.monitoring[0].id,valid.ids[0]);
 assert.equal(value.monitoring[0].media.length,1);assert.equal(value.monitoring[0].references.length,1);assert.match(value.monitoring[0].href,/blog=my_blog&open=/);
 assert.ok(!JSON.stringify(value).includes('타인 비공개 내용'));assert.ok(!JSON.stringify(value).includes('javascript:'));assert.equal(value.citations.length,1);
 const selected=overview(db,owner,'second_blog');assert.equal(selected.metrics.cited,0);assert.deepEqual(selected.monitoring,[]);assert.match(selected.citationHref,/blog=second_blog/);
});

test('change feed compares only successful checked measurements of the same post and keyword',async t=>{
 const {db,owner,blog}=await fixture(t),id=post(db,blog.id);
 run(db,owner,blog.id,NOW-600,[{post:id,rank:1,exposed:1}]);
 run(db,owner,blog.id,NOW-500,[{post:id,status:'error'}]);
 run(db,owner,blog.id,NOW-400,[{post:id,keyword:'다른 검색어'}]);
 assert.deepEqual(overview(db,owner).changes,[],'error or changed query is not a loss');
 run(db,owner,blog.id,NOW-300,[{post:id}]);
 run(db,owner,blog.id,NOW-200,[{post:id,rank:3,exposed:1}]);
 run(db,owner,blog.id,NOW-100,[{post:id}],'failed');
 run(db,owner,blog.id,NOW+100,[{post:id}]);
 scan(db,owner,blog.id,65,NOW-50);
 const value=overview(db,owner),kinds=value.changes.map(c=>c.kind);
 assert.deepEqual(kinds,['scan','citation_gained','exposure_gained','citation_lost','exposure_lost']);
 assert.ok(value.changes.every(c=>c.at<=NOW));assert.ok(value.changes.filter(c=>c.kind!=='scan').every(c=>c.href.startsWith('/dashboard/ai-picks?blog=my_blog&open=')));
});

test('recommendation summary and links use only the selected blog and do not generate records',async t=>{
 const {db,owner,other,blog,foreign}=await fixture(t);
 recommendation(db,owner,blog.id,'재추천','revisit');recommendation(db,owner,blog.id,'다시 쓰기','rewritten');recommendation(db,owner,blog.id,'선점 후보','opportunity');
 for(let i=0;i<12;i++)recommendation(db,owner,blog.id,`신규 ${i}`);
 recommendation(db,other,foreign.id,'타인 비공개 추천');recommendation(db,owner,blog.id,'미래 추천','new',NOW+1);
 const value=overview(db,owner);assert.equal(value.metrics.revisit,2);assert.equal(value.metrics.opportunity,1);assert.equal(value.metrics.recommendations,15);assert.equal(value.recommendations.length,12);
 assert.ok(value.recommendations.every(r=>new URL(r.href,'https://local.test').searchParams.get('blogId')===blog.id));
 assert.ok(value.recommendations.every(r=>new URL(r.href,'https://local.test').searchParams.get('q')===r.phrase));
 assert.ok(!JSON.stringify(value).includes('타인 비공개 추천'));assert.ok(!JSON.stringify(value).includes('미래 추천'));
 assert.equal(db.prepare('SELECT count(*) AS n FROM recommendation_builds').get()!.n,0);
});

test('cited posts expose real metrics and detail links, ignoring future metric rows',async t=>{
 const {db,owner,other,blog}=await fixture(t),id=post(db,blog.id);
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(other);
 const key=createKeyword(db,other,{phrase:'제주 여행',category:'여행'},NOW-300);
 addKeywordMetric(db,other,key.id,{pcVolume:10,mobileVolume:20,documentCount:90},NOW-200);
 addKeywordMetric(db,other,key.id,{pcVolume:100,mobileVolume:200,documentCount:100},NOW+100);
 const checked=run(db,owner,blog.id,NOW-100,[{post:id,rank:2}]);
 const value=overview(db,owner),row=value.citedPosts[0];assert.equal(row.volume,30);assert.equal(row.saturation,3);assert.equal(row.id,checked.ids[0]);assert.equal(row.href,`/dashboard/ai-picks?blog=my_blog&open=${row.id}`);
});

test('rank cards honor public status, category-relative order, confirmed history and primary labels',async t=>{
 const {db,owner,other,blog,foreign,user}=await fixture(t),peer=await user('peer');
 const peerBlog=createBlog(db,peer,{naverId:'peer_blog',title:'여행 동료',category:'여행',isPrimary:true});
 db.prepare('UPDATE profiles SET ranking_public=1').run();
 // Last week: other=1, peer=2, owner=3 globally; owner=2 within travel.
 const previous=Date.parse('2026-10-09T06:00:00Z');
 scan(db,other,foreign.id,95,previous);scan(db,peer,peerBlog.id,85,previous);scan(db,owner,blog.id,70,previous);
 confirmPeriod(db,'week',-1,NOW);
 // Current: owner is global 2, travel 1. A future peer score must not change that.
 scan(db,owner,blog.id,90,NOW-300);scan(db,other,foreign.id,98,NOW-200);scan(db,peer,peerBlog.id,80,NOW-100);scan(db,peer,peerBlog.id,100,NOW+1);
 const value=overview(db,owner),all=value.rankings.find(r=>r.scope==='all')!,category=value.rankings.find(r=>r.scope==='category')!;
 assert.ok(all.cards.every(c=>c.rank===2&&c.participants===3));assert.ok(category.cards.every(c=>c.rank===1&&c.participants===2));
 const week=category.cards.find(c=>c.period==='week')!;assert.equal(week.delta,1);assert.deepEqual(week.history.map(p=>p.rank),[2,1]);assert.equal(all.cards.find(c=>c.period==='week')!.delta,1);
 assert.equal(value.changes.filter(c=>c.kind==='rank').length,1,'global ranking event is not duplicated for category scope');
 assert.match(value.changes.find(c=>c.kind==='rank')!.title,/주간 순위 1계단 상승/);
 assert.deepEqual(all.cards.find(c=>c.period==='all')!.history,[]);assert.equal(all.cards.find(c=>c.period==='month')!.delta,null);
 const secondary=createBlog(db,owner,{naverId:'secondary_blog',title:'보조',category:'경제'});scan(db,owner,secondary.id,100,NOW-10);
 const selected=overview(db,owner,'secondary_blog');assert.ok(selected.rankings.flatMap(r=>r.cards).every(c=>c.periodLabel.startsWith('대표 블로그')));assert.equal(selected.rankings.find(r=>r.scope==='category')!.label,'여행');
 db.prepare('UPDATE profiles SET ranking_public=0 WHERE user_id=?').run(owner);
 const hidden=overview(db,owner);assert.ok(hidden.rankings.flatMap(r=>r.cards).every(c=>!c.public&&c.rank===null&&c.delta===null&&c.history.length===0));assert.ok(!hidden.changes.some(c=>c.kind==='rank'));
});

test('rank feed uses confirmed prior month/week evidence and suppresses unchanged, equal-time and current-period comparisons',async t=>{
 const {db,owner,other,blog,foreign}=await fixture(t);
 db.prepare('UPDATE profiles SET ranking_public=1').run();
 for(const period of ['month','week'] as const){
  const previous=periodRange(period,-1,NOW),at=previous.end-100;
  scan(db,owner,blog.id,90,at);scan(db,other,foreign.id,80,at);confirmPeriod(db,period,-1,NOW);
 }
 scan(db,owner,blog.id,70,NOW-200);scan(db,other,foreign.id,95,NOW-100);
 const events=overview(db,owner).changes.filter(c=>c.kind==='rank');
 assert.equal(events.length,2);assert.ok(events.every(c=>c.href==='/ranking'&&c.at===NOW&&c.description==='대표 블로그 · 전체 1위 → 2위'));
 assert.deepEqual(events.map(c=>c.title).sort(),['월간 순위 1계단 하락','주간 순위 1계단 하락']);

 // A malformed period ending inside the current period is not earlier-period evidence.
 const week=periodRange('week',-1,NOW);
 db.prepare("UPDATE ranking_periods SET ends_at=? WHERE period_type='week' AND period_key=?").run(NOW,week.key);
 assert.deepEqual(overview(db,owner).changes.filter(c=>c.kind==='rank').map(c=>c.title),['월간 순위 1계단 하락']);
 db.prepare("UPDATE ranking_periods SET ends_at=? WHERE period_type='week' AND period_key=?").run(week.end,week.key);

 // At the exact boundary, the prior confirmation and current measurement have the same timestamp.
 const boundary=periodRange('week',0,NOW).start;
 db.prepare("UPDATE ranking_periods SET confirmed_at=? WHERE period_type='week' AND period_key=?").run(boundary,week.key);
 scan(db,owner,blog.id,70,boundary);scan(db,other,foreign.id,95,boundary);
 assert.ok(!overview(db,owner,undefined,boundary).changes.some(c=>c.kind==='rank'));

 db.prepare('UPDATE ranking_snapshots SET rank=2 WHERE user_id=?').run(owner);
 assert.ok(!overview(db,owner).changes.some(c=>c.kind==='rank'),'unchanged ranks do not create events');
});
