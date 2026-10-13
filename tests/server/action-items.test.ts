import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {enqueueScan} from '../../src/server/jobs/queue';
import {saveScanResult} from '../../src/server/analysis/results';
import {analyzePosts} from '../../src/server/analysis/rules';
import {listActionItems,updateActionItem} from '../../src/server/analysis/action-items';
import {buildDashboardPage} from '../../src/server/analysis/dashboard-page';
import type {CapturedNode} from '../../src/types/site';

type El=Exclude<CapturedNode,string>;
const all=(nodes:CapturedNode[],f:(n:El)=>boolean,out:El[]=[]):El[]=>{for(const n of nodes){if(typeof n==='string')continue;if(f(n))out.push(n);all(n.children,f,out);}return out;};
const NOW=Date.parse('2026-10-13T03:00:00Z');

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const a=(await register(db,{email:'a@example.test',password:'action-long-password',nickname:'A',termsAccepted:true})).user.id;
 const b=(await register(db,{email:'b@example.test',password:'action-long-password',nickname:'B',termsAccepted:true})).user.id;
 const blog=createBlog(db,a,{naverId:'act_blog',title:'블로그',category:'',isPrimary:true});
 const job=enqueueScan(db,a,{blogId:blog.id},NOW);
 const report=analyzePosts([{title:'짧음',category:'',tags:[],publishedAt:NOW-200*86_400_000}],NOW);
 const resultId=saveScanResult(db,{ownerId:a,blogId:blog.id,jobId:job.id,report,postCount:1,measuredAt:NOW});
 return{db,a,b,resultId,report};
}

test('saving a scan result creates one open to-do per action, owner-only',async t=>{
 const {db,a,b,report}=await fixture(t);
 const items=listActionItems(db,a);
 assert.equal(items.length,report.actions.length);
 assert.ok(items.every(i=>i.status==='open'));
 assert.equal(listActionItems(db,b).length,0);
});

test('mark done and undo with versions; others cannot touch it',async t=>{
 const {db,a,b}=await fixture(t);
 const [first]=listActionItems(db,a);
 assert.throws(()=>updateActionItem(db,b,first.id,{status:'done',version:1}),{status:404});
 const done=updateActionItem(db,a,first.id,{status:'done',version:1});
 assert.equal(done.status,'done');assert.equal(done.version,2);
 assert.throws(()=>updateActionItem(db,a,first.id,{status:'open',version:1}),{status:409,code:'VERSION_CONFLICT'});
 assert.throws(()=>updateActionItem(db,a,first.id,{status:'later',version:2}),{name:'ZodError'});
 assert.equal(updateActionItem(db,a,first.id,{status:'open',version:2}).status,'open');
});

test('the dashboard to-do list shows saved state with toggle controls',async t=>{
 const {db,a}=await fixture(t);
 const [first]=listActionItems(db,a);
 updateActionItem(db,a,first.id,{status:'done',version:1});
 const page=await buildDashboardPage(db,a,NOW+1000);
 const toggles=all(page.body,n=>n.attrs['data-action-id']!==undefined);
 assert.equal(toggles.length,listActionItems(db,a).length);
 const t1=toggles.find(x=>x.attrs['data-action-id']===first.id)!;
 assert.equal(t1.attrs['aria-pressed'],'true');assert.equal(t1.attrs['data-version'],'2');
 const todo=all(page.body,n=>n.attrs.id==='today-todo');
 const titles=all(todo,n=>(n.attrs.class??'').split(/\s+/).includes('mui-9m8hl0')).map(n=>n.children.join(''));
 const items=listActionItems(db,a);
 assert.deepEqual(titles,items.map(i=>i.status==='done'?`✓ ${i.title}`:i.title),'to-do titles are the real actions, not captured text');
});
