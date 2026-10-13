import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {record} from '../../src/server/credits/ledger';
import {getCapturedPage} from '../../src/lib/pages';
import {memberChrome} from '../../src/server/content/member-chrome';
import {findAll,textOf} from '../../src/server/content/tree';

test('member navigation replaces captured identity, plan and credits for every captured dashboard',async t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const user=(await register(db,{email:'chrome@example.test',password:'member-chrome-test-password',nickname:'Current Writer',termsAccepted:true})).user.id;
 record(db,{ownerId:user,delta:23,reason:'grant'},Date.now());
 for(const path of ['/dashboard','/dashboard/ai-picks','/dashboard/events','/dashboard/mate','/dashboard/competitors','/dashboard/recommendations','/dashboard/write']){
  const captured=(await getCapturedPage(path))!,before=JSON.stringify(captured);
  const view=memberChrome(db,user,captured);
  const nav=findAll(view.body,n=>n.tag==='nav').map(textOf).join('');
  assert.match(nav,/잔액 23토큰/,path);
  assert.match(nav,/Current Writer/,path);
  assert.doesNotMatch(nav,/175토큰|베이직 체험|NAEO 블로거/,path);
  assert.equal(JSON.stringify(captured),before,'source capture is not mutated');
 }
});
