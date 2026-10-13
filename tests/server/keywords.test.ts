import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {listAdminKeywords,getAdminKeyword,createKeyword,updateKeyword,deleteKeyword,addKeywordMetric,deleteKeywordMetric} from '../../src/server/keywords/admin-keywords';
import {listRecommendations,setKeywordState,classify} from '../../src/server/keywords/recommendations';

const NOW=Date.parse('2026-10-13T03:00:00Z');
const DAY=86_400_000;
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const make=async(email:string)=>(await register(db,{email,password:'keyword-long-password',nickname:'K',termsAccepted:true})).user.id;
 const admin=await make('admin@example.test'),member=await make('member@example.test'),other=await make('other@example.test');
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin);
 return{db,admin,member,other};
}
const audits=(db:Database,action:string)=>(db.prepare('SELECT count(*) AS n FROM audit_logs WHERE action=?').get(action) as {n:number}).n;
const kw=(db:Database,admin:string,phrase:string,[pc,mobile,docs]:[number,number,number],at=NOW)=>{
 const k=createKeyword(db,admin,{phrase,category:'여행'},at);
 addKeywordMetric(db,admin,k.id,{pcVolume:pc,mobileVolume:mobile,documentCount:docs,measuredAt:new Date(at).toISOString()},at);
 return k;
};

test('classification rules (new): saturation = documents / total searches',()=>{
 assert.deepEqual(classify({pcVolume:600,mobileVolume:900,documentCount:1200}),{total:1500,saturation:0.8,golden:true,preempt:false,level:'여유'});
 assert.deepEqual(classify({pcVolume:100,mobileVolume:300,documentCount:800}),{total:400,saturation:2,golden:false,preempt:true,level:'보통'});
 assert.deepEqual(classify({pcVolume:10,mobileVolume:10,documentCount:500}),{total:20,saturation:25,golden:false,preempt:false,level:'포화'});
 assert.deepEqual(classify(null),{total:null,saturation:null,golden:false,preempt:false,level:null});
 assert.equal(classify({pcVolume:0,mobileVolume:0,documentCount:10}).saturation,null,'no division by zero');
});

test('admin keyword CRUD: unique phrase, versions, metrics history, audit, permissions',async t=>{
 const {db,admin,member}=await fixture(t);
 assert.throws(()=>createKeyword(db,member,{phrase:'제주 여행'}),{status:403});
 const k=createKeyword(db,admin,{phrase:'제주 여행',category:'여행'});
 assert.throws(()=>createKeyword(db,admin,{phrase:'제주 여행'}),{status:409,code:'KEYWORD_EXISTS'});
 assert.throws(()=>createKeyword(db,admin,{phrase:''}),{name:'ZodError'});
 assert.throws(()=>addKeywordMetric(db,admin,k.id,{pcVolume:-1,mobileVolume:0,documentCount:0}),{name:'ZodError'});
 const m1=addKeywordMetric(db,admin,k.id,{pcVolume:100,mobileVolume:200,documentCount:150,measuredAt:new Date(NOW-DAY).toISOString()});
 addKeywordMetric(db,admin,k.id,{pcVolume:300,mobileVolume:900,documentCount:600,measuredAt:new Date(NOW).toISOString()});
 const detail=getAdminKeyword(db,admin,k.id);
 assert.equal(detail.metrics.length,2);assert.equal(detail.latest?.pcVolume,300,'latest metric by measured time');
 assert.equal(detail.latest?.source,'manual');
 deleteKeywordMetric(db,admin,k.id,m1.id);
 assert.equal(getAdminKeyword(db,admin,k.id).metrics.length,1);
 const edited=updateKeyword(db,admin,k.id,{status:'hidden',version:1});
 assert.equal(edited.version,2);
 assert.throws(()=>updateKeyword(db,admin,k.id,{category:'x',version:1}),{status:409,code:'VERSION_CONFLICT'});
 assert.equal(listAdminKeywords(db,admin,{q:'제주'}).pagination.total,1);
 assert.equal(listAdminKeywords(db,admin,{q:'%'}).pagination.total,0,'LIKE escaped');
 deleteKeyword(db,admin,k.id,{version:2});
 assert.throws(()=>getAdminKeyword(db,admin,k.id),{status:404});
 for(const a of ['admin.keyword.create','admin.keyword.update','admin.keyword.delete','admin.keyword.metric.create','admin.keyword.metric.delete'])assert.ok(audits(db,a)>=1,a);
});

test('members see active keywords with metrics, filters, search, paging and their own state',async t=>{
 const {db,admin,member,other}=await fixture(t);
 const golden=kw(db,admin,'제주 3박4일 코스',[600,900,1200],NOW-2*DAY);
 const preempt=kw(db,admin,'제주 렌터카 할인',[100,300,800],NOW-10*DAY);
 kw(db,admin,'제주 날씨',[10,10,500],NOW-40*DAY);
 const hidden=kw(db,admin,'숨김 키워드',[1000,1000,10]);
 updateKeyword(db,admin,hidden.id,{status:'hidden',version:1});
 const all=listRecommendations(db,member,{},NOW);
 assert.equal(all.pagination.total,3,'hidden keywords are not recommended');
 assert.equal(all.summary.golden,1);assert.equal(all.summary.preempt,1);
 assert.deepEqual(all.data.map(r=>r.phrase),['제주 3박4일 코스','제주 렌터카 할인','제주 날씨'],'newest recommendation first');
 assert.equal(listRecommendations(db,member,{filter:'golden'},NOW).data[0].id,golden.id);
 assert.equal(listRecommendations(db,member,{filter:'preempt'},NOW).data[0].id,preempt.id);
 assert.equal(listRecommendations(db,member,{period:'week'},NOW).pagination.total,1);
 assert.equal(listRecommendations(db,member,{period:'month'},NOW).pagination.total,2);
 assert.equal(listRecommendations(db,member,{q:'렌터카'},NOW).pagination.total,1);
 assert.equal(listRecommendations(db,member,{pageSize:2,page:2},NOW).data.length,1);
 const written=setKeywordState(db,member,golden.id,{status:'written'});
 assert.equal(written.status,'written');
 assert.equal(listRecommendations(db,member,{filter:'written'},NOW).pagination.total,1);
 assert.equal(listRecommendations(db,other,{filter:'written'},NOW).pagination.total,0,'state is per member');
 assert.equal(listRecommendations(db,member,{},NOW).summary.written,1);
 setKeywordState(db,member,golden.id,{status:null});
 assert.equal(listRecommendations(db,member,{filter:'written'},NOW).pagination.total,0,'unmark');
 assert.throws(()=>setKeywordState(db,member,hidden.id,{status:'written'}),{status:404},'cannot mark hidden keywords');
 assert.throws(()=>listRecommendations(db,member,{filter:'nope'},NOW),{name:'ZodError'});
});
