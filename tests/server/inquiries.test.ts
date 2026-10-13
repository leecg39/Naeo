import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,type Database} from '../../src/server/database';
import {register,userById} from '../../src/server/auth';
import {eraseAccount} from '../../src/server/account-security';
import {createInquiry,listMyInquiries,getMyInquiry,updateMyInquiry,deleteMyInquiry} from '../../src/server/inquiries/inquiries';
import {listAdminInquiries,getAdminInquiry,updateInquiryStatus,addReply,updateReply,deleteReply,deleteInquiry} from '../../src/server/inquiries/admin-inquiries';
import {listTemplates,createTemplate,updateTemplate,deleteTemplate} from '../../src/server/inquiries/templates';

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const make=async(email:string)=>(await register(db,{email,password:'inquiry-long-password',nickname:'문의',termsAccepted:true})).user;
 const admin=await make('admin@example.test'),member=await make('member@example.test'),other=await make('other@example.test');
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
 return {db,admin:userById(db,admin.id),member:userById(db,member.id),other:userById(db,other.id)};
}
const form=(over:Record<string,unknown>={})=>({type:'service',email:'reply@example.test',subject:'요금 문의',message:'체험 기간이 궁금합니다.',...over});
const audits=(db:Database,action:string)=>(db.prepare('SELECT count(*) AS n FROM audit_logs WHERE action=?').get(action) as {n:number}).n;

test('guests and members create inquiries; members only see their own',async t=>{
 const {db,member,other}=await fixture(t);
 const guest=createInquiry(db,null,form({email:'guest@example.test'}));
 assert.equal(guest.ownerId,null);assert.equal(guest.status,'open');
 const mine=createInquiry(db,member,form());
 assert.equal(mine.ownerId,member.id);assert.equal(mine.version,1);
 assert.equal(listMyInquiries(db,member.id,{}).pagination.total,1);
 assert.equal(listMyInquiries(db,other.id,{}).pagination.total,0);
 assert.throws(()=>getMyInquiry(db,other.id,mine.id),{status:404});
 assert.throws(()=>getMyInquiry(db,member.id,guest.id),{status:404});
 assert.equal(getMyInquiry(db,member.id,mine.id).replies.length,0);
 assert.ok(audits(db,'inquiry.create')===2);
 const meta=db.prepare("SELECT metadata FROM audit_logs WHERE action='inquiry.create'").all() as {metadata:string}[];
 assert.ok(meta.every(m=>!m.metadata.includes('@')),'audit metadata must not hold e-mail addresses');
});

test('inquiry input is validated',async t=>{
 const {db}=await fixture(t);
 for(const bad of [form({email:'nope'}),form({message:'   '}),form({message:'x'.repeat(5001)}),form({subject:'x'.repeat(201)}),form({type:'spam'}),form({extra:1})])
  assert.throws(()=>createInquiry(db,null,bad),{name:'ZodError'});
 const trimmed=createInquiry(db,null,form({email:' Reply@Example.TEST ',subject:'  ',message:'  내용  '}));
 assert.equal(trimmed.email,'reply@example.test');assert.equal(trimmed.subject,'');assert.equal(trimmed.message,'내용');
});

test('members edit open inquiries with versions and cannot edit after an answer',async t=>{
 const {db,admin,member,other}=await fixture(t);
 const a=createInquiry(db,member,form());
 assert.throws(()=>updateMyInquiry(db,other.id,a.id,{message:'남의 글',version:1}),{status:404});
 const edited=updateMyInquiry(db,member.id,a.id,{message:'수정한 내용',type:'technical',version:1});
 assert.equal(edited.message,'수정한 내용');assert.equal(edited.type,'technical');assert.equal(edited.version,2);
 assert.throws(()=>updateMyInquiry(db,member.id,a.id,{message:'오래된',version:1}),{status:409,code:'VERSION_CONFLICT'});
 addReply(db,admin.id,a.id,{body:'답변드립니다.',version:2});
 assert.throws(()=>updateMyInquiry(db,member.id,a.id,{message:'답변 뒤 수정',version:3}),{status:409,code:'INQUIRY_LOCKED'});
 const detail=getMyInquiry(db,member.id,a.id);
 assert.equal(detail.status,'answered');assert.equal(detail.replies[0].body,'답변드립니다.');
 assert.equal('authorId' in detail.replies[0],false,'members do not see which admin replied');
 assert.throws(()=>deleteMyInquiry(db,member.id,a.id,{version:1}),{status:409});
 deleteMyInquiry(db,member.id,a.id,{version:detail.version});
 assert.throws(()=>getAdminInquiry(db,admin.id,a.id),{status:404});
 assert.equal((db.prepare('SELECT count(*) AS n FROM inquiry_messages').get() as {n:number}).n,0);
});

test('admin search, status, reply CRUD, delete, permissions and audit',async t=>{
 const {db,admin,member}=await fixture(t);
 assert.throws(()=>listAdminInquiries(db,member.id,{}),{status:403});
 const a=createInquiry(db,null,form({subject:'B2B 100%_도입',type:'business'}));
 createInquiry(db,member,form({subject:'다른 문의'}));
 assert.equal(listAdminInquiries(db,admin.id,{}).pagination.total,2);
 assert.equal(listAdminInquiries(db,admin.id,{q:'100%_'}).data[0].id,a.id);
 assert.equal(listAdminInquiries(db,admin.id,{q:'%'}).pagination.total,1,'LIKE wildcards are escaped');
 assert.equal(listAdminInquiries(db,admin.id,{type:'business'}).pagination.total,1);
 assert.throws(()=>addReply(db,member.id,a.id,{body:'x',version:1}),{status:403});
 const replied=addReply(db,admin.id,a.id,{body:'첫 답변',version:1});
 assert.equal(replied.status,'answered');assert.ok(replied.answeredAt);assert.equal(replied.version,2);
 const reply=replied.replies[0];
 assert.equal(reply.delivery,'not_configured','no mail provider: replies are stored, not sent');
 const edited=updateReply(db,admin.id,a.id,reply.id,{body:'고친 답변',version:2});
 assert.equal(edited.replies[0].body,'고친 답변');assert.equal(edited.version,3);
 assert.throws(()=>updateReply(db,admin.id,a.id,reply.id,{body:'x',version:2}),{status:409});
 assert.equal(listAdminInquiries(db,admin.id,{status:'answered'}).pagination.total,1);
 const closed=updateInquiryStatus(db,admin.id,a.id,{status:'closed',version:3});
 assert.equal(closed.status,'closed');
 const removed=deleteReply(db,admin.id,a.id,reply.id,{version:4});
 assert.equal(removed.replies.length,0);
 assert.throws(()=>deleteReply(db,admin.id,a.id,reply.id,{version:5}),{status:404});
 deleteInquiry(db,admin.id,a.id,{version:5});
 assert.throws(()=>getAdminInquiry(db,admin.id,a.id),{status:404});
 for(const action of ['admin.inquiry.reply.create','admin.inquiry.reply.update','admin.inquiry.reply.delete','admin.inquiry.status','admin.inquiry.delete'])assert.equal(audits(db,action),1,action);
});

test('reply templates CRUD with unique names and versions',async t=>{
 const {db,admin,member}=await fixture(t);
 assert.throws(()=>createTemplate(db,member.id,{name:'x',body:'y'}),{status:403});
 const tpl=createTemplate(db,admin.id,{name:'요금 안내',subject:'요금제 안내',body:'요금제는 /pricing 에서 확인하세요.'});
 assert.equal(tpl.version,1);
 assert.throws(()=>createTemplate(db,admin.id,{name:'요금 안내',body:'중복'}),{status:409,code:'TEMPLATE_EXISTS'});
 assert.throws(()=>createTemplate(db,admin.id,{name:'',body:'y'}),{name:'ZodError'});
 const updated=updateTemplate(db,admin.id,tpl.id,{body:'바뀐 본문',version:1});
 assert.equal(updated.body,'바뀐 본문');assert.equal(updated.version,2);
 assert.throws(()=>updateTemplate(db,admin.id,tpl.id,{body:'x',version:1}),{status:409});
 assert.equal(listTemplates(db,admin.id).length,1);
 deleteTemplate(db,admin.id,tpl.id,{version:2});
 assert.equal(listTemplates(db,admin.id).length,0);
});

test('deleting an account removes that member\'s inquiries',async t=>{
 const {db,member}=await fixture(t);
 createInquiry(db,member,form());
 eraseAccount(db,member.id,member.id);
 assert.equal((db.prepare('SELECT count(*) AS n FROM inquiries').get() as {n:number}).n,0);
});

test('rows handed to client components are plain objects (React rejects null-prototype rows)',async t=>{
 const {db,admin,member}=await fixture(t);
 createTemplate(db,admin.id,{name:'기본',body:'감사합니다.'});
 const a=createInquiry(db,member,form());
 addReply(db,admin.id,a.id,{body:'답변',version:1});
 const plain=(v:object)=>Object.getPrototypeOf(v)===Object.prototype;
 assert.ok(listTemplates(db,admin.id).every(plain),'templates');
 assert.ok(getAdminInquiry(db,admin.id,a.id).replies.every(plain),'admin replies');
 assert.ok(getMyInquiry(db,member.id,a.id).replies.every(plain),'member replies');
 assert.ok(listAdminInquiries(db,admin.id,{}).data.every(plain),'admin list');
});
