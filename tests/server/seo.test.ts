import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {applySeeds,applyPageSettingSeeds} from '../../src/server/content/seed';
import {createArticle,updateArticle} from '../../src/server/content/admin-articles';
import {createDocument} from '../../src/server/content/admin-documents';
import {listPageSettings,updatePageSetting} from '../../src/server/content/admin-page-settings';
import {sitemapEntries,rssXml,llmsTxt,robotsRules} from '../../src/server/content/seo';

const ORIGIN='https://clone.example';
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());applySeeds(db);await applyPageSettingSeeds(db);
 const admin=(await register(db,{email:'admin@example.test',password:'admin-long-password',nickname:'관리자',termsAccepted:true})).user;
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
 const marketing=(db.prepare("SELECT id FROM article_categories WHERE slug='marketing'").get() as {id:string}).id;
 return{db,admin:admin.id,marketing};
}
const urls=(db:Parameters<typeof sitemapEntries>[0])=>sitemapEntries(db,ORIGIN).map(e=>e.url.replace(ORIGIN,''));

test('sitemap lists public pages and published content only',async t=>{
 const {db,admin,marketing}=await fixture(t);
 const list=urls(db);
 for(const p of ['/','/faq','/updates','/blog','/terms','/privacy','/refund','/features','/guide/writing','/blog/marketing/golden-keywords'])assert.ok(list.includes(p),p);
 for(const p of ['/dashboard','/admin','/login','/updates/2026-06-24-golden-keywords','/preview','/dev/nav-preview'])assert.ok(!list.includes(p),'excluded '+p);
 assert.equal(new Set(list).size,list.length,'no duplicates');
 assert.equal(list.filter(p=>p.startsWith('/blog/')).length,20);
 createArticle(db,admin,{categoryId:marketing,slug:'seo-draft',title:'초안',status:'draft'});
 createArticle(db,admin,{categoryId:marketing,slug:'seo-future',title:'예약',status:'published',publishedAt:new Date(Date.now()+86400000).toISOString()});
 const live=createArticle(db,admin,{categoryId:marketing,slug:'seo-live',title:'공개',status:'published'});
 createDocument(db,admin,{path:'/draft-policy',title:'초안 문서'});
 const features=listPageSettings(db,admin).find(p=>p.path==='/features')!;
 updatePageSetting(db,admin,features.id,{status:'hidden',version:1});
 const after=urls(db);
 assert.ok(after.includes('/blog/marketing/seo-live'));
 for(const p of ['/blog/marketing/seo-draft','/blog/marketing/seo-future','/draft-policy','/features'])assert.ok(!after.includes(p),'hidden '+p);
 updateArticle(db,admin,live.id,{status:'archived',version:1});
 assert.ok(!urls(db).includes('/blog/marketing/seo-live'),'archived removed');
});

test('RSS is valid XML with escaped text, absolute links and no drafts',async t=>{
 const {db,admin,marketing}=await fixture(t);
 createArticle(db,admin,{categoryId:marketing,slug:'rss-escape',title:'A & B <script>"x"</script>',summary:'요약 & <b>굵게</b>',status:'published'});
 createArticle(db,admin,{categoryId:marketing,slug:'rss-draft',title:'초안 글',status:'draft'});
 const xml=rssXml(db,ORIGIN);
 assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
 assert.ok(xml.includes('<title>A &amp; B &lt;script&gt;&quot;x&quot;&lt;/script&gt;</title>'));
 assert.ok(!xml.includes('<script>'));
 assert.ok(xml.includes(`<link>${ORIGIN}/blog/marketing/rss-escape</link>`));
 assert.ok(!xml.includes('rss-draft'));
 assert.equal((xml.match(/<item>/g)??[]).length,20,'latest 20 items');
});

test('llms.txt indexes published content with absolute links only',async t=>{
 const {db,admin,marketing}=await fixture(t);
 createArticle(db,admin,{categoryId:marketing,slug:'llms-draft',title:'LLM 초안',status:'draft'});
 const text=llmsTxt(db,ORIGIN);
 assert.ok(text.startsWith('# NAEO'));
 assert.ok(text.includes(`(${ORIGIN}/blog/marketing/golden-keywords)`));
 assert.ok(text.includes(`(${ORIGIN}/terms)`));
 assert.ok(!text.includes('llms-draft'));
 assert.ok(!/\]\(\/(?!\/)/.test(text),'no relative links');
});

test('robots blocks crawling unless indexing is explicitly enabled',()=>{
 const off=robotsRules(ORIGIN,false);
 assert.deepEqual(off.rules,{userAgent:'*',disallow:'/'});
 const on=robotsRules(ORIGIN,true);
 assert.equal(on.sitemap,`${ORIGIN}/sitemap.xml`);
 const rule=on.rules as {allow:string;disallow:string[]};
 assert.equal(rule.allow,'/');
 for(const p of ['/admin/','/api/','/dashboard/','/login'])assert.ok(rule.disallow.includes(p),p);
});
