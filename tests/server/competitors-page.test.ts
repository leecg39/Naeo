import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {addCompetitor,refreshCompetitor} from '../../src/server/competitors/competitors';
import {buildCompetitorsPage} from '../../src/server/competitors/competitors-page';
import type {CapturedNode} from '../../src/types/site';

type El=Exclude<CapturedNode,string>;
const all=(nodes:CapturedNode[],f:(n:El)=>boolean,out:El[]=[]):El[]=>{for(const n of nodes){if(typeof n==='string')continue;if(f(n))out.push(n);all(n.children,f,out);}return out;};
const text=(n:CapturedNode):string=>typeof n==='string'?n:n.children.map(text).join('');
const NOW=Date.parse('2026-10-13T03:00:00Z');
const rss=`<rss><channel><title>경쟁 블로그</title><item><title>제주 여행 코스 총정리 가이드 1편</title><link>https://blog.naver.com/rival_page/1</link><category>여행</category><tag>a,b,c</tag><pubDate>${new Date(NOW).toUTCString()}</pubDate></item></channel></rss>`;

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const user=(await register(db,{email:'c@example.test',password:'competitor-page-pass',nickname:'C',termsAccepted:true})).user.id;
 return{db,user};
}

test('captured keyword ranking data is removed; empty state invites adding a competitor',async t=>{
 const {db,user}=await fixture(t);
 const page=await buildCompetitorsPage(db,user);
 assert.equal(all(page.body,n=>n.tag==='td'&&/위$/.test(text(n))).length,0,'no captured rank cells');
 assert.equal(all(page.body,n=>n.attrs['data-competitor-id']!==undefined).length,0);
 assert.ok(all(page.body,n=>n.tag==='form'&&n.attrs['data-competitor-add']!==undefined).length===1);
 assert.match(text(page.body[0]??''),/./);
 assert.match(JSON.stringify(page.body),/검색 API 설정 전/,'keyword ranking marked as not configured');
});

test('rows show competitors with snapshot score, comparison and controls',async t=>{
 const {db,user}=await fixture(t);
 const c=addCompetitor(db,user,{blog:'rival_page',note:'주말 발행'},NOW);
 await refreshCompetitor(db,user,c.id,async()=>new Response(rss),NOW);
 addCompetitor(db,user,{blog:'not_yet',note:''},NOW);
 const page=await buildCompetitorsPage(db,user);
 const rows=all(page.body,n=>n.attrs['data-competitor-id']!==undefined);
 assert.equal(rows.length,2);
 assert.match(text(rows[0]),/rival_page/);assert.match(text(rows[0]),/주말 발행/);assert.match(text(rows[0]),/\d+점/);
 assert.match(text(rows[1]),/아직 수집 전/);
 assert.ok(all([rows[0]],n=>n.attrs['data-action']==='refresh').length===1);
 assert.ok(all([rows[0]],n=>n.attrs['data-action']==='delete').length===1);
 assert.ok(all([rows[0]],n=>n.attrs['data-action']==='note').length===1);
 assert.match(text(all(page.body,n=>n.attrs['data-competitor-count']!==undefined)[0]),/2 \/ 10/);
});
