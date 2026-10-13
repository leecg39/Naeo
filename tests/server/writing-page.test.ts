import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {record} from '../../src/server/credits/ledger';
import {seedPlans} from '../../src/server/billing/seed';
import {createKeyword} from '../../src/server/keywords/admin-keywords';
import {startTrial} from '../../src/server/billing/subscriptions';
import {buildWritingPage} from '../../src/server/writing/writing-page';
import {findAll,textOf} from '../../src/server/content/tree';

const NOW=Date.parse('2026-10-14T03:00:00Z');
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const user=(await register(db,{email:'writer-page@example.test',password:'writing-page-test-password',nickname:'Writer',termsAccepted:true})).user.id;
 return{db,user};
}

test('writing screen uses the owner ledger and removes captured credit, trial and promotion claims',async t=>{
 const {db,user}=await fixture(t);
 const other=(await register(db,{email:'other-page@example.test',password:'other-page-test-password',nickname:'Other',termsAccepted:true})).user.id;
 record(db,{ownerId:other,delta:175,reason:'grant'},NOW);
 const before=await buildWritingPage(db,user,NOW),text=before.body.map(textOf).join('');
 assert.doesNotMatch(text,/175토큰|175\/175|체험 동안|오늘 2편|커피 한 잔|총 3장 예상 = AI 3|고용산재 토탈서비스|120,710|2026년 10월 20일/);
 assert.match(text,/잔액 0토큰/);
 assert.match(text,/이용 중인 구독 없음/);
 assert.ok(findAll(before.body,n=>n.tag==='input'&&n.attrs.maxlength==='60').length,'writing form is preserved');
 record(db,{ownerId:user,delta:23,reason:'grant'},NOW);
 const after=await buildWritingPage(db,user,NOW);
 assert.match(after.body.map(textOf).join(''),/잔액 23토큰/);
 assert.equal(after.source,'database');
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user);
 createKeyword(db,user,{phrase:'실제 글감 키워드',category:'IT'},NOW);
 createKeyword(db,user,{phrase:'숨긴 키워드',category:'IT',status:'hidden'},NOW);
 const live=(await buildWritingPage(db,user,NOW)).body.map(textOf).join('');
 assert.match(live,/실제 글감 키워드/);
 assert.doesNotMatch(live,/숨긴 키워드/);
});

test('writing trial label comes from a live subscription and disappears at its expiry',async t=>{
 const {db,user}=await fixture(t);await seedPlans(db,NOW);
 createBlog(db,user,{naverId:'writing_test',title:'Test',category:'',isPrimary:true});
 const sub=startTrial(db,user,{planCode:'basic'},NOW);
 const text=(await buildWritingPage(db,user,NOW)).body.map(textOf).join('');
 assert.match(text,/베이직.*체험 중/);
 assert.match(text,/잔액 175토큰/);
 assert.match(text,/2026\. 10\. 21\./);
 const expired=(await buildWritingPage(db,user,sub.currentPeriodEnd)).body.map(textOf).join('');
 assert.match(expired,/이용 중인 구독 없음/);
 assert.doesNotMatch(expired,/체험 중/);
});
