import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createDraft} from '../../src/server/writing/drafts';
import {exportDraft,nodesToHtml} from '../../src/server/writing/export';
import {listAdminTemplates,createWritingTemplate,updateWritingTemplate,deleteWritingTemplate,activeTemplates} from '../../src/server/generation/templates';
import {listAdminGenerations,adminCancelGeneration} from '../../src/server/generation/admin-generations';
import {requestGeneration} from '../../src/server/generation/generation';
import {grantCredits,balance} from '../../src/server/credits/ledger';
import {buildRequest} from '../../src/server/generation/provider';

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const admin=(await register(db,{email:'admin@example.test',password:'writing-admin-pass',nickname:'관리자',termsAccepted:true})).user.id;
 const a=(await register(db,{email:'a@example.test',password:'writing-admin-pass',nickname:'A',termsAccepted:true})).user.id;
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin);
 return{db,admin,a};
}
const audits=(db:Database,action:string)=>(db.prepare('SELECT count(*) AS n FROM audit_logs WHERE action=?').get(action) as {n:number}).n;
const configured={provider:'anthropic',model:'m',apiKey:'k',baseUrl:'https://api.anthropic.com'} as const;

test('export turns markdown into safe HTML, markdown or plain text',async t=>{
 const {db,a}=await fixture(t);
 const d=createDraft(db,a,{title:'제주 <여행> & 맛집',body:'## 첫날\n\n**렌터카** [지도](https://map.naver.com) [나쁜](javascript:alert(1))\n\n<script>alert(1)</script>\n\n- 항목'});
 const html=exportDraft(db,a,d.id,'html');
 assert.equal(html.contentType,'text/html; charset=utf-8');
 assert.match(html.body,/^<h1>제주 &lt;여행&gt; &amp; 맛집<\/h1>/);
 assert.match(html.body,/<h2[^>]*>첫날<\/h2>/);assert.match(html.body,/<strong>렌터카<\/strong>/);
 assert.match(html.body,/<a href="https:\/\/map\.naver\.com"[^>]*>지도<\/a>/);
 assert.ok(!/<script|javascript:|onerror/i.test(html.body),'no executable markup');
 assert.equal(exportDraft(db,a,d.id,'markdown').body,`# ${d.title}\n\n${d.body}\n`);
 const text=exportDraft(db,a,d.id,'text').body;
 assert.ok(text.startsWith('제주 <여행> & 맛집\n\n'));assert.ok(!text.includes('**'));
 assert.equal(nodesToHtml([{tag:'iframe',attrs:{src:'x'},children:['t']},{tag:'p',attrs:{onclick:'x',class:'c'},children:['"<q>"']}]),'t<p>&quot;&lt;q&gt;&quot;</p>','unknown tags dropped, attributes filtered');
});

test('writing templates: admin CRUD with versions; members see active ones; guidance stays out of user content',async t=>{
 const {db,admin,a}=await fixture(t);
 assert.throws(()=>createWritingTemplate(db,a,{name:'x',guidance:'y'}),{status:403});
 const tpl=createWritingTemplate(db,admin,{name:'여행 후기',category:'여행',guidance:'일정을 날짜별로 정리하고 비용을 표로 넣어주세요.'});
 assert.throws(()=>createWritingTemplate(db,admin,{name:'여행 후기',guidance:'중복'}),{status:409,code:'TEMPLATE_EXISTS'});
 assert.equal(activeTemplates(db).length,1);
 const hidden=updateWritingTemplate(db,admin,tpl.id,{status:'hidden',version:1});
 assert.equal(hidden.version,2);assert.equal(activeTemplates(db).length,0);
 assert.throws(()=>updateWritingTemplate(db,admin,tpl.id,{name:'x',version:1}),{status:409,code:'VERSION_CONFLICT'});
 updateWritingTemplate(db,admin,tpl.id,{status:'active',version:2});
 const req=buildRequest({keyword:'제주',category:'여행',title:'',experience:'',instructions:''},'m','일정을 날짜별로');
 assert.match(req.system,/운영자 작성 지침/);assert.match(req.system,/일정을 날짜별로/);
 assert.ok(!req.messages[0].content.includes('일정을 날짜별로'));
 grantCredits(db,admin,a,{delta:10,note:'QA'});
 assert.throws(()=>requestGeneration(db,a,{keyword:'k',idempotencyKey:'t1',templateId:'00000000-0000-4000-8000-000000000000'},configured),{status:404,code:'TEMPLATE_NOT_FOUND'});
 const job=requestGeneration(db,a,{keyword:'k',idempotencyKey:'t2',templateId:tpl.id},configured);
 assert.equal(job.state,'queued');
 assert.equal(listAdminTemplates(db,admin).length,1);
 deleteWritingTemplate(db,admin,tpl.id,{version:3});
 assert.equal(listAdminTemplates(db,admin).length,0);
 for(const x of ['admin.writing_template.create','admin.writing_template.update','admin.writing_template.delete'])assert.ok(audits(db,x)>=1,x);
});

test('admin generation jobs: list across members with search and cancel with refund',async t=>{
 const {db,admin,a}=await fixture(t);
 grantCredits(db,admin,a,{delta:20,note:'QA'});
 const job=requestGeneration(db,a,{keyword:'제주 여행',idempotencyKey:'j1'},configured);
 assert.throws(()=>listAdminGenerations(db,a,{}),{status:403});
 const list=listAdminGenerations(db,admin,{q:'a@example'});
 assert.equal(list.pagination.total,1);assert.equal(list.data[0].ownerEmail,'a@example.test');assert.equal(list.data[0].keyword,'제주 여행');
 assert.equal(balance(db,a),10);
 assert.equal(adminCancelGeneration(db,admin,job.id).state,'canceled');
 assert.equal(balance(db,a),20,'refunded');
 assert.ok(audits(db,'admin.generation.cancel')>=1);
 assert.throws(()=>adminCancelGeneration(db,admin,job.id),{status:409});
});
