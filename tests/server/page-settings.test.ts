import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {applySeeds,applyPageSettingSeeds} from '../../src/server/content/seed';
import {MANAGED_PAGES,resolveManagedPage} from '../../src/server/content/page-settings';
import {listPageSettings,updatePageSetting,restorePageSettingRevision,getPageSetting} from '../../src/server/content/admin-page-settings';
import {getCapturedPage} from '../../src/lib/pages';

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());applySeeds(db);await applyPageSettingSeeds(db);
 const admin=(await register(db,{email:'admin@example.test',password:'admin-long-password',nickname:'관리자',termsAccepted:true})).user;
 const member=(await register(db,{email:'member@example.test',password:'member-long-password',nickname:'회원',termsAccepted:true})).user;
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
 return{db,admin:admin.id,member:member.id};
}
const strip=(t:string)=>t.replace(/(?: \| NAEO)+$/,'');

test('fixed-design pages are seeded and render the captured body with the stored title',async t=>{
 const {db}=await fixture(t);
 assert.deepEqual(MANAGED_PAGES,['/features','/guide/writing','/guide/extension-publish']);
 for(const path of MANAGED_PAGES){
  const page=await resolveManagedPage(db,path);
  const captured=await getCapturedPage(path);
  assert.ok(page&&captured,path);
  assert.equal(strip(page.title),strip(captured.title),path);
  assert.deepEqual(page.body,captured.body,path+' body untouched');
 }
 assert.equal(await resolveManagedPage(db,'/pricing'),undefined,'not managed');
});

test('page setting seed runs once and keeps admin edits',async t=>{
 const {db,admin}=await fixture(t);
 const p=listPageSettings(db,admin)[0];
 updatePageSetting(db,admin,p.id,{status:'hidden',version:1});
 await applyPageSettingSeeds(db);
 assert.equal(listPageSettings(db,admin).length,3);
 assert.equal(listPageSettings(db,admin)[0].status,'hidden');
});

test('admins edit title/description and hide pages; hidden pages are 404; revisions restore',async t=>{
 const {db,admin,member}=await fixture(t);
 assert.throws(()=>listPageSettings(db,member),{status:403});
 const features=listPageSettings(db,admin).find(p=>p.path==='/features')!;
 assert.throws(()=>updatePageSetting(db,member,features.id,{title:'x',version:1}),{status:403});
 const edited=updatePageSetting(db,admin,features.id,{title:'기능 한눈에 보기',description:'NAEO 기능 설명',version:1});
 assert.equal(edited.version,2);
 const page=await resolveManagedPage(db,'/features');
 assert.equal(strip(page!.title),'기능 한눈에 보기');assert.equal(page!.description,'NAEO 기능 설명');
 assert.throws(()=>updatePageSetting(db,admin,features.id,{title:'x',version:1}),{status:409,code:'VERSION_CONFLICT'});
 const hidden=updatePageSetting(db,admin,features.id,{status:'hidden',version:2});
 assert.equal(await resolveManagedPage(db,'/features'),null,'hidden → 404');
 assert.deepEqual(getPageSetting(db,admin,features.id).revisions.map(r=>r.version),[3,2,1]);
 const restored=restorePageSettingRevision(db,admin,features.id,{revision:1,version:hidden.version});
 assert.equal(strip(restored.title),strip(features.title));assert.equal(restored.status,'hidden','restore keeps visibility');
 for(const bad of [{title:'',version:restored.version},{description:'x'.repeat(301),version:restored.version},{status:'deleted',version:restored.version},{path:'/x',version:restored.version}])
  assert.throws(()=>updatePageSetting(db,admin,features.id,bad),{name:'ZodError'});
});
