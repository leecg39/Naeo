import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createKeyword,addKeywordMetric} from '../../src/server/keywords/admin-keywords';
import {setKeywordState} from '../../src/server/keywords/recommendations';
import {createMemberKeyword} from '../../src/server/keywords/member-keywords';
import {buildRecommendationsPage} from '../../src/server/keywords/recommendations-page';
import type {CapturedNode} from '../../src/types/site';
const NOW=Date.parse('2026-10-17T06:00:00Z');
type El=Exclude<CapturedNode,string>;
const all=(nodes:CapturedNode[],f:(n:El)=>boolean,out:El[]=[]):El[]=>{for(const n of nodes){if(typeof n==='string')continue;if(f(n))out.push(n);all(n.children,f,out);}return out;};
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const admin=(await register(db,{email:'admin@example.test',password:'keyword-page-long',nickname:'관리자',termsAccepted:true})).user.id;
 const member=(await register(db,{email:'member@example.test',password:'keyword-page-long',nickname:'회원',termsAccepted:true})).user.id;
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin);return{db,admin,member};
}
test('keyword workspace replaces captured rows and exposes a real empty state',async t=>{
 const {db,member}=await fixture(t),page=await buildRecommendationsPage(db,member,{},NOW);
 assert.equal(all(page.body,n=>n.attrs['data-naeo-slot']==='keyword-workspace').length,1);
 const main=all(page.body,n=>n.tag==='main')[0];assert.equal(main.children.length,1);
 assert.equal(page.recommendations?.list.pagination.total,0);assert.deepEqual(page.recommendations?.suggestions,[]);
 assert.equal(all([main],n=>n.attrs.role==='row').length,0,'captured keyword rows never remain behind the live workspace');
});
test('SSR includes actual catalog and owned personal data with metrics and states',async t=>{
 const {db,admin,member}=await fixture(t);
 const g=createKeyword(db,admin,{phrase:'제주 코스',category:'여행'},NOW-1000);addKeywordMetric(db,admin,g.id,{pcVolume:600,mobileVolume:900,documentCount:1200},NOW);setKeywordState(db,member,g.id,{status:'written'});
 createMemberKeyword(db,member,{phrase:'내 글감'},NOW);createMemberKeyword(db,admin,{phrase:'타인 비밀'},NOW);
 const page=await buildRecommendationsPage(db,member,{},NOW),data=page.recommendations!.list;
 assert.equal(data.pagination.total,2);assert.equal(data.summary.written,1);assert.equal(data.summary.golden,1);
 assert.equal(data.data.find(r=>r.id===g.id)?.saturation,.8);assert.ok(!JSON.stringify(data).includes('타인 비밀'));
});
test('URL search, filters, sort and pagination are reflected before rendering',async t=>{
 const {db,admin,member}=await fixture(t);
 for(let i=0;i<55;i++)createKeyword(db,admin,{phrase:`키워드 ${String(i).padStart(2,'0')}`},NOW-i*1000);
 const p1=await buildRecommendationsPage(db,member,{},NOW);assert.equal(p1.recommendations?.list.data.length,25);
 const p3=await buildRecommendationsPage(db,member,{page:'3'},NOW);assert.equal(p3.recommendations?.list.data.length,5);
 const search=await buildRecommendationsPage(db,member,{q:'키워드 07'},NOW);assert.equal(search.recommendations?.list.data.length,1);assert.equal(search.recommendations?.list.query.q,'키워드 07');
 const empty=await buildRecommendationsPage(db,member,{filter:'saved',sort:'total_desc'},NOW);assert.equal(empty.recommendations?.list.pagination.total,0);
 const invalid=await buildRecommendationsPage(db,member,{page:'-1',sort:'bad'},NOW);assert.equal(invalid.recommendations?.list.pagination.page,1);
});
