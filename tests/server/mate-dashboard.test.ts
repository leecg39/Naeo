import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {diagnoseBlog} from '../../src/server/mate/mate';
import {buildMateDashboardPage} from '../../src/server/mate/mate-dashboard';
import type {CapturedNode} from '../../src/types/site';

type El=Exclude<CapturedNode,string>;
const all=(nodes:CapturedNode[],f:(n:El)=>boolean,out:El[]=[]):El[]=>{for(const n of nodes){if(typeof n==='string')continue;if(f(n))out.push(n);all(n.children,f,out);}return out;};
const text=(n:CapturedNode):string=>typeof n==='string'?n:n.children.map(text).join('');
const NOW=Date.parse('2026-10-13T03:00:00Z');
const rss=(id:string)=>`<rss><channel><title>QA</title><item><title>제주 여행 코스 총정리 가이드 1편</title><link>https://blog.naver.com/${id}/1</link><category>여행</category><tag>a,b,c</tag><pubDate>${new Date(NOW).toUTCString()}</pubDate></item></channel></rss>`;

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const user=(await register(db,{email:'m@example.test',password:'mate-long-password',nickname:'M',termsAccepted:true})).user;
 return{db,user:user.id};
}

test('empty history keeps the honest empty state linking to /mate',async t=>{
 const {db,user}=await fixture(t);
 const page=await buildMateDashboardPage(db,user,NOW);
 assert.equal(all(page.body,n=>n.tag==='h5').length,1);
 assert.equal(all(page.body,n=>n.attrs['data-mate-report']!==undefined).length,0);
 assert.ok(all(page.body,n=>n.tag==='a'&&n.attrs.href==='/mate').length>=1);
});

test('own reports are listed with score, share link and delete control; others are not',async t=>{
 const {db,user}=await fixture(t);
 const mine=await diagnoseBlog(db,{blog:'qa_blog',peer:'p1',userId:user},async()=>new Response(rss('qa_blog')),NOW);
 await diagnoseBlog(db,{blog:'other_blog',peer:'p2',userId:null},async()=>new Response(rss('other_blog')),NOW);
 const page=await buildMateDashboardPage(db,user,NOW+60_000);
 const items=all(page.body,n=>n.attrs['data-mate-report']!==undefined);
 assert.equal(items.length,1);
 assert.equal(items[0].attrs['data-mate-report'],mine.token);
 assert.match(text(items[0]),new RegExp(`qa_blog.*${mine.report.score}점`));
 assert.equal(all(items,n=>n.tag==='a'&&n.attrs.href===`/mate/s?r=${mine.token}`).length,1);
 assert.equal(all(items,n=>n.attrs['data-mate-delete']===mine.token).length,1);
 assert.match(text(all(page.body,n=>n.tag==='h5')[0]),/진단 기록 1건/);
});
