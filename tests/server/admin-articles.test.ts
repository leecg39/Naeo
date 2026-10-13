import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {applySeeds} from '../../src/server/content/seed';
import {getPublishedArticle} from '../../src/server/content/articles';
import {listAdminArticles,getAdminArticle,createArticle,updateArticle,deleteArticle,restoreArticleRevision,previewMarkdown,
 listAdminCategories,createCategory,updateCategory,deleteCategory,defaultReadMinutes} from '../../src/server/content/admin-articles';

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());applySeeds(db);
 const admin=(await register(db,{email:'admin@example.test',password:'admin-long-password',nickname:'관리자',termsAccepted:true})).user;
 const member=(await register(db,{email:'member@example.test',password:'member-long-password',nickname:'회원',termsAccepted:true})).user;
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
 const marketing=(db.prepare("SELECT id FROM article_categories WHERE slug='marketing'").get() as {id:string}).id;
 return {db,admin:admin.id,member:member.id,marketing};
}
const draft=(categoryId:string,over:Record<string,unknown>={})=>({categoryId,slug:'new-article',title:'새 글',summary:'요약',bodyMarkdown:'## 소개\n\n본문입니다.',tags:['AEO'],coverImage:'/assets/9dbb98fdf0aaf429.webp',status:'draft',...over});
const audits=(db:Database,action:string)=>(db.prepare('SELECT count(*) AS n FROM audit_logs WHERE action=?').get(action) as {n:number}).n;

test('only admins can manage articles and categories',async t=>{
 const {db,member,marketing}=await fixture(t);
 assert.throws(()=>listAdminArticles(db,member,{}),{status:403});
 assert.throws(()=>createArticle(db,member,draft(marketing)),{status:403});
 assert.throws(()=>createCategory(db,member,{slug:'tips',name:'팁'}),{status:403});
});

test('create → read → update → publish → unpublish → delete with versions, revisions and audit',async t=>{
 const {db,admin,marketing}=await fixture(t);
 const created=createArticle(db,admin,draft(marketing));
 assert.equal(created.status,'draft');assert.equal(created.version,1);assert.equal(created.publishedAt,null);
 assert.equal(getPublishedArticle(db,'marketing','new-article'),null,'drafts are not public');
 const updated=updateArticle(db,admin,created.id,{title:'수정한 글',version:1});
 assert.equal(updated.title,'수정한 글');assert.equal(updated.version,2);
 assert.throws(()=>updateArticle(db,admin,created.id,{title:'오래된 수정',version:1}),{status:409,code:'VERSION_CONFLICT'});
 const published=updateArticle(db,admin,created.id,{status:'published',version:2});
 assert.ok(published.publishedAt&&published.publishedAt<=Date.now());
 assert.equal(getPublishedArticle(db,'marketing','new-article')?.title,'수정한 글');
 const hidden=updateArticle(db,admin,created.id,{status:'archived',version:3});
 assert.equal(getPublishedArticle(db,'marketing','new-article'),null);
 assert.deepEqual(getAdminArticle(db,admin,created.id).revisions.map(r=>r.version),[4,3,2,1]);
 assert.throws(()=>deleteArticle(db,admin,created.id,{version:3}),{status:409});
 deleteArticle(db,admin,created.id,{version:hidden.version});
 assert.throws(()=>getAdminArticle(db,admin,created.id),{status:404});
 assert.equal((db.prepare('SELECT count(*) AS n FROM content_revisions WHERE resource_id=?').get(created.id) as {n:number}).n,0);
 for(const a of ['content.article.create','content.article.update','content.article.delete'])assert.ok(audits(db,a)>0,a);
});

test('slug conflicts, invalid input and unsafe markdown are rejected',async t=>{
 const {db,admin,marketing}=await fixture(t);
 assert.throws(()=>createArticle(db,admin,draft(marketing,{slug:'golden-keywords'})),{status:409,code:'SLUG_EXISTS'});
 assert.throws(()=>createArticle(db,admin,draft(marketing,{slug:'Bad Slug'})),{name:'ZodError'});
 assert.throws(()=>createArticle(db,admin,draft(marketing,{coverImage:'javascript:alert(1)'})),{name:'ZodError'});
 assert.throws(()=>createArticle(db,admin,draft(marketing,{categoryId:'00000000-0000-4000-8000-000000000000'})),{status:404});
 assert.throws(()=>createArticle(db,admin,draft(marketing,{status:'published',extra:1})),{name:'ZodError'});
 assert.throws(()=>createArticle(db,admin,draft(marketing,{bodyMarkdown:'[x](javascript:alert(1))'})),{status:400,code:'CONTENT_INVALID'});
 assert.throws(()=>createArticle(db,admin,draft(marketing,{bodyMarkdown:'<script>alert(1)</script>'})),{status:400,code:'CONTENT_INVALID'});
 assert.throws(()=>createArticle(db,admin,draft(marketing,{bodyMarkdown:'::evil'})),{status:400,code:'CONTENT_INVALID'});
 assert.throws(()=>createArticle(db,admin,draft(marketing,{tags:['a','a']})),{name:'ZodError'});
});

test('read time defaults from body length and can be overridden',async t=>{
 const {db,admin,marketing}=await fixture(t);
 assert.equal(defaultReadMinutes('가'.repeat(900)),5);
 assert.equal(defaultReadMinutes('짧음'),1);
 assert.equal(createArticle(db,admin,draft(marketing,{bodyMarkdown:'가'.repeat(900)})).readMinutes,5);
 assert.equal(createArticle(db,admin,draft(marketing,{slug:'manual',readMinutes:12})).readMinutes,12);
});

test('scheduled publishing keeps future articles hidden until their time',async t=>{
 const {db,admin,marketing}=await fixture(t);
 const future=new Date(Date.now()+86_400_000).toISOString();
 createArticle(db,admin,draft(marketing,{status:'published',publishedAt:future}));
 assert.equal(getPublishedArticle(db,'marketing','new-article'),null);
 assert.equal(getPublishedArticle(db,'marketing','new-article',Date.now()+2*86_400_000)?.slug,'new-article');
});

test('restoring a revision creates a new version with the old content',async t=>{
 const {db,admin,marketing}=await fixture(t);
 const a=createArticle(db,admin,draft(marketing));
 updateArticle(db,admin,a.id,{title:'두 번째',bodyMarkdown:'바뀐 본문',version:1});
 const restored=restoreArticleRevision(db,admin,a.id,{revision:1,version:2});
 assert.equal(restored.title,'새 글');assert.equal(restored.bodyMarkdown,'## 소개\n\n본문입니다.');assert.equal(restored.version,3);
 assert.throws(()=>restoreArticleRevision(db,admin,a.id,{revision:99,version:3}),{status:404});
});

test('listing searches all statuses with pagination',async t=>{
 const {db,admin,marketing}=await fixture(t);
 createArticle(db,admin,draft(marketing,{title:'검색용 초안 100%_특수'}));
 const all=listAdminArticles(db,admin,{});
 assert.equal(all.pagination.total,21);
 assert.equal(listAdminArticles(db,admin,{status:'draft'}).pagination.total,1);
 assert.equal(listAdminArticles(db,admin,{q:'100%_'}).data[0].title,'검색용 초안 100%_특수');
 const percent=listAdminArticles(db,admin,{q:'%'});
 assert.ok(percent.pagination.total<21&&percent.data.every(a=>`${a.title}${a.slug}${a.summary}`.includes('%')),'LIKE wildcards are escaped');
 assert.equal(listAdminArticles(db,admin,{category:'news'}).pagination.total,3);
 assert.equal(listAdminArticles(db,admin,{pageSize:5,page:2}).data.length,5);
});

test('preview reports headings, warnings and read time without saving',async t=>{
 const {db}=await fixture(t);
 const before=(db.prepare('SELECT count(*) AS n FROM articles').get() as {n:number}).n;
 const p=previewMarkdown({bodyMarkdown:'## 하나\n\n[x](javascript:1)'});
 assert.deepEqual(p.headings.map(h=>h.id),['하나']);
 assert.equal(p.warnings.length,1);assert.equal(p.readMinutes,1);
 assert.equal((db.prepare('SELECT count(*) AS n FROM articles').get() as {n:number}).n,before);
});

test('category CRUD guards slugs, versions and in-use deletion',async t=>{
 const {db,admin,marketing}=await fixture(t);
 assert.equal(listAdminCategories(db,admin).length,4);
 const c=createCategory(db,admin,{slug:'tips',name:'팁',sortOrder:9});
 assert.throws(()=>createCategory(db,admin,{slug:'tips',name:'중복'}),{status:409,code:'SLUG_EXISTS'});
 const renamed=updateCategory(db,admin,c.id,{name:'블로그 팁',version:1});
 assert.equal(renamed.name,'블로그 팁');assert.equal(renamed.version,2);
 assert.throws(()=>updateCategory(db,admin,c.id,{name:'x',version:1}),{status:409});
 assert.throws(()=>deleteCategory(db,admin,marketing,{version:1}),{status:409,code:'CATEGORY_IN_USE'});
 deleteCategory(db,admin,c.id,{version:2});
 assert.equal(listAdminCategories(db,admin).length,4);
});

test('moving an article to another category changes its public URL',async t=>{
 const {db,admin}=await fixture(t);
 const guide=(db.prepare("SELECT id FROM article_categories WHERE slug='guide'").get() as {id:string}).id;
 const a=getPublishedArticle(db,'marketing','golden-keywords')!;
 assert.throws(()=>updateArticle(db,admin,a.id,{categoryId:guide,slug:'golden-keywords-guide',version:a.version}),{status:409,code:'SLUG_EXISTS'});
 const moved=updateArticle(db,admin,a.id,{categoryId:guide,version:a.version});
 assert.equal(moved.url,'/blog/guide/golden-keywords');
 assert.equal(getPublishedArticle(db,'marketing','golden-keywords'),null);
});
