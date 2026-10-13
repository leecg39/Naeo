import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {applySeeds} from '../../src/server/content/seed';
import {listCategories,listPublishedArticles,getPublishedArticle,blogIndexSections} from '../../src/server/content/articles';

function fixture(t:TestContext){const db=openDatabase(':memory:');t.after(()=>db.close());applySeeds(db);return db;}
const count=(db:ReturnType<typeof openDatabase>,sql:string)=>(db.prepare(sql).get() as {n:number}).n;

test('seed inserts 4 categories and 20 published articles exactly once',t=>{
 const db=fixture(t);
 assert.equal(count(db,'SELECT count(*) AS n FROM article_categories'),4);
 assert.equal(count(db,"SELECT count(*) AS n FROM articles WHERE status='published'"),20);
 applySeeds(db);
 assert.equal(count(db,'SELECT count(*) AS n FROM articles'),20);
});

test('admin deletions are not revived by a later seed run',t=>{
 const db=fixture(t);
 db.prepare("DELETE FROM articles WHERE slug='golden-keywords'").run();
 applySeeds(db);
 assert.equal(count(db,'SELECT count(*) AS n FROM articles'),19);
});

test('public listing orders by publish date desc then position and hides drafts/archived',t=>{
 const db=fixture(t);
 const marketing=listPublishedArticles(db,{category:'marketing'}).map(a=>a.slug);
 assert.deepEqual(marketing.slice(0,4),['ai-briefing-tips-1-travel-life','ai-briefing-tips-2-life-culture','ai-briefing-tips-3-knowledge-hobby','golden-keywords']);
 assert.equal(marketing.at(-1),'what-is-ai-briefing');
 db.prepare("UPDATE articles SET status='draft' WHERE slug='golden-keywords'").run();
 db.prepare("UPDATE articles SET status='archived' WHERE slug='what-is-ai-briefing'").run();
 const after=listPublishedArticles(db,{}).map(a=>a.slug);
 assert.equal(after.length,18);
 assert.ok(!after.includes('golden-keywords')&&!after.includes('what-is-ai-briefing'));
});

test('future-dated published articles stay hidden until their publish time',t=>{
 const db=fixture(t);
 db.prepare("UPDATE articles SET published_at=? WHERE slug='golden-keywords'").run(Date.now()+3_600_000);
 assert.equal(getPublishedArticle(db,'marketing','golden-keywords'),null);
 assert.ok(!listPublishedArticles(db,{}).some(a=>a.slug==='golden-keywords'));
});

test('single article lookup requires matching category and published status',t=>{
 const db=fixture(t);
 const a=getPublishedArticle(db,'marketing','golden-keywords');
 assert.ok(a);
 assert.equal(a.category.name,'마케팅');
 assert.deepEqual(a.tags,['황금 키워드','키워드 전략','선점 기회','AEO']);
 assert.equal(getPublishedArticle(db,'guide','golden-keywords'),null);
 db.prepare("UPDATE articles SET status='draft' WHERE slug='golden-keywords'").run();
 assert.equal(getPublishedArticle(db,'marketing','golden-keywords'),null);
});

test('categories report published counts in sort order',t=>{
 const db=fixture(t);
 assert.deepEqual(listCategories(db).map(c=>[c.slug,c.name,c.publishedCount]),[['marketing','마케팅',9],['guide','사용 가이드',7],['news','언론 보도',3],['event','이벤트',1]]);
});

test('blog index sections reproduce the captured grouping',t=>{
 const db=fixture(t);
 const s=blogIndexSections(db);
 assert.deepEqual(s.featured.map(a=>a.slug),['golden-keywords','golden-keywords-guide']);
 assert.deepEqual(s.news.map(a=>a.slug),['naver-mate-naeo-byline','across-modu-startup-ditoday','across-modu-startup-mt']);
 assert.equal(s.event?.slug,'naeo-review-event');
 assert.equal(s.rest.length,14);
 assert.equal(s.rest[0].slug,'ai-briefing-tips-1-travel-life');
 assert.equal(s.rest.at(-1)?.slug,'what-is-ai-briefing');
});

test('a category in use cannot be deleted; revisions are removed with their article',t=>{
 const db=fixture(t);
 assert.throws(()=>db.prepare("DELETE FROM article_categories WHERE slug='marketing'").run(),/FOREIGN KEY/);
 const id=(db.prepare("SELECT id FROM articles WHERE slug='golden-keywords'").get() as {id:string}).id;
 db.prepare("INSERT INTO content_revisions VALUES('r1','article',?,1,'{}',NULL,1)").run(id);
 db.prepare('DELETE FROM articles WHERE id=?').run(id);
 assert.equal(count(db,"SELECT count(*) AS n FROM content_revisions WHERE resource_id='"+id+"'"),0);
});
