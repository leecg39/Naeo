import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createKeyword,addKeywordMetric} from '../../src/server/keywords/admin-keywords';
import {setKeywordState} from '../../src/server/keywords/recommendations';
import {buildRecommendationsPage} from '../../src/server/keywords/recommendations-page';
import type {CapturedNode} from '../../src/types/site';

type El=Exclude<CapturedNode,string>;
const all=(nodes:CapturedNode[],f:(n:El)=>boolean,out:El[]=[]):El[]=>{for(const n of nodes){if(typeof n==='string')continue;if(f(n))out.push(n);all(n.children,f,out);}return out;};
const text=(n:CapturedNode):string=>typeof n==='string'?n:n.children.map(text).join('');
const NOW=Date.parse('2026-10-13T03:00:00Z');
const DAY=86_400_000;

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const admin=(await register(db,{email:'a@example.test',password:'reco-long-password',nickname:'A',termsAccepted:true})).user.id;
 const member=(await register(db,{email:'m@example.test',password:'reco-long-password',nickname:'M',termsAccepted:true})).user.id;
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin);
 return{db,admin,member};
}
const rows=(body:CapturedNode[])=>all(body,n=>n.attrs.role==='row'&&n.attrs['data-keyword-id']!==undefined);

test('empty state replaces the captured account keywords',async t=>{
 const {db,member}=await fixture(t);
 const page=await buildRecommendationsPage(db,member,{},NOW);
 assert.equal(rows(page.body).length,0);
 assert.equal(all(page.body,n=>/ 작성 완료 표시$/.test(n.attrs['aria-label']??'')).length,0,'no captured keyword controls');
 assert.match(text(all(page.body,n=>n.attrs.role==='status'&&(n.attrs.class??'').includes('mui-1sk9a2v'))[0]),/추천할 키워드가 없습니다/);
});

test('rows come from the database with metrics, flags, member state and data attributes',async t=>{
 const {db,admin,member}=await fixture(t);
 const g=createKeyword(db,admin,{phrase:'제주 3박4일 코스',category:'여행'},NOW-DAY);
 addKeywordMetric(db,admin,g.id,{pcVolume:600,mobileVolume:900,documentCount:1200},NOW);
 const plain=createKeyword(db,admin,{phrase:'지표 없는 키워드'},NOW-40*DAY);
 setKeywordState(db,member,g.id,{status:'written'});
 const page=await buildRecommendationsPage(db,member,{},NOW);
 const list=rows(page.body);
 assert.deepEqual(list.map(r=>r.attrs['data-keyword-id']),[g.id,plain.id]);
 assert.equal(list[0].attrs['data-golden'],'true');assert.equal(list[0].attrs['data-day'],String(NOW-DAY));
 assert.match(text(list[0]),/제주 3박4일 코스/);assert.match(text(list[0]),/1,500/);assert.match(text(list[0]),/0\.8/);
 assert.equal(all([list[0]],n=>n.tag==='input')[0].attrs.checked,'','written state checked');
 assert.equal(all([list[1]],n=>n.tag==='input')[0].attrs.checked,undefined);
 assert.match(text(list[1]),/—/,'missing metrics shown as dash');
 const golden=all(page.body,n=>/^황금 키워드:/.test(n.attrs['aria-label']??''))[0];
 assert.equal(golden.attrs['aria-label'],'황금 키워드: 1, 클릭하여 필터');
 assert.match(text(all(page.body,n=>(n.attrs.class??'').includes('mui-1ptiu1r'))[0]),/새 규칙/);
 const cards=all(page.body,n=>(n.attrs.id??'').startsWith('kw-card-'));
 assert.equal(cards.length,2,'mobile cards match rows');
});

test('search and page links are server-side',async t=>{
 const {db,admin,member}=await fixture(t);
 for(let i=0;i<55;i++)createKeyword(db,admin,{phrase:`키워드 ${String(i).padStart(2,'0')}`},NOW-i*60_000);
 const p1=await buildRecommendationsPage(db,member,{},NOW);
 assert.equal(rows(p1.body).length,50);
 assert.ok(all(p1.body,n=>n.tag==='a'&&n.attrs.href==='/dashboard/recommendations?page=2').length===1);
 const p2=await buildRecommendationsPage(db,member,{page:'2'},NOW);
 assert.equal(rows(p2.body).length,5);
 const search=await buildRecommendationsPage(db,member,{q:'키워드 07'},NOW);
 assert.equal(rows(search.body).length,1);
 assert.equal(all(search.body,n=>n.tag==='input'&&n.attrs.name==='q')[0].attrs.value,'키워드 07');
});
