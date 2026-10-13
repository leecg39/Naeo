import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import seed from '../../data/content/articles.seed.json';
import documentSeed from '../../data/content/documents.seed.json';
import faqSeed from '../../data/content/faq.seed.json';
import updatesSeed from '../../data/content/updates.seed.json';
import {getCapturedPage} from '../../lib/pages';
import {MANAGED_PAGES,displayTitle} from './page-settings';
import {seedEvents} from '../events/seed';

const ARTICLES_SEED='articles-v1';
const DOCUMENTS_SEED='documents-v1';
const FAQ_SEED='faq-v1';
const UPDATES_SEED='updates-v1';
const PAGES_SEED='page-settings-v1';

/**
 * 캡처한 기사 20개를 한 번만 넣는다. 실행 기록을 seed_runs에 남겨
 * 관리자가 이후 수정·삭제한 글을 덮어쓰거나 되살리지 않는다.
 */
export function applySeeds(db:Database,now=Date.now()):void{
 seedArticles(db,now);
 seedDocuments(db,now);
 seedFaq(db,now);
 seedUpdates(db,now);
 seedEvents(db,now);
}

/** 고정 디자인 페이지 설정은 캡처 파일을 읽어야 해서 비동기로 한 번만 넣는다. */
export async function applyPageSettingSeeds(db:Database,now=Date.now()):Promise<void>{
 if(db.prepare('SELECT 1 FROM seed_runs WHERE name=?').get(PAGES_SEED))return;
 const pages=await Promise.all(MANAGED_PAGES.map(async path=>({path,page:await getCapturedPage(path)})));
 transaction(db,()=>{
  if(db.prepare('SELECT 1 FROM seed_runs WHERE name=?').get(PAGES_SEED))return;
  const insert=db.prepare("INSERT INTO page_settings(id,path,title,description,status,created_at,updated_at) VALUES(?,?,?,?,'published',?,?) ON CONFLICT(path) DO NOTHING");
  for(const {path,page} of pages)if(page)insert.run(randomUUID(),path,displayTitle(page.title),page.description,now,now);
  db.prepare('INSERT INTO seed_runs(name,applied_at) VALUES(?,?)').run(PAGES_SEED,now);
 });
}

function seedArticles(db:Database,now:number):void{
 transaction(db,()=>{
  if(db.prepare('SELECT 1 FROM seed_runs WHERE name=?').get(ARTICLES_SEED))return;
  const categoryIds=new Map<string,string>();
  const insertCategory=db.prepare('INSERT INTO article_categories(id,slug,name,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?)');
  for(const c of seed.categories){
   const existing=db.prepare('SELECT id FROM article_categories WHERE slug=?').get(c.slug) as {id:string}|undefined;
   const id=existing?.id??randomUUID();
   if(!existing)insertCategory.run(id,c.slug,c.name,c.sortOrder,now,now);
   categoryIds.set(c.slug,id);
  }
  const insertArticle=db.prepare(`INSERT INTO articles(id,category_id,slug,title,summary,show_summary,body_markdown,tags_json,cover_image,featured,status,published_at,read_minutes,position,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,'published',?,?,?,?,?) ON CONFLICT(category_id,slug) DO NOTHING`);
  for(const a of seed.articles){
   insertArticle.run(randomUUID(),categoryIds.get(a.category)!,a.slug,a.title,a.summary,a.showSummary?1:0,a.bodyMarkdown,JSON.stringify(a.tags),a.coverImage,a.featured?1:0,Date.parse(a.publishedAt),a.readMinutes,a.position,now,now);
  }
  db.prepare('INSERT INTO seed_runs(name,applied_at) VALUES(?,?)').run(ARTICLES_SEED,now);
 });
}

/** 캡처한 정책 문서 4개(약관·개인정보·확장 개인정보·환불)를 한 번만 넣는다. 이후 삭제·수정은 덮어쓰지 않는다. */
function seedDocuments(db:Database,now:number):void{
 transaction(db,()=>{
  if(db.prepare('SELECT 1 FROM seed_runs WHERE name=?').get(DOCUMENTS_SEED))return;
  const insert=db.prepare(`INSERT INTO site_documents(id,path,title,effective_label,body,closing_note,status,position,created_at,updated_at)
   VALUES(?,?,?,?,?,?,'published',?,?,?) ON CONFLICT(path) DO NOTHING`);
  for(const d of documentSeed.documents)insert.run(randomUUID(),d.path,d.title,d.effectiveLabel,d.body,d.closingNote,d.position,now,now);
  db.prepare('INSERT INTO seed_runs(name,applied_at) VALUES(?,?)').run(DOCUMENTS_SEED,now);
 });
}

/** 캡처한 FAQ 21개를 한 번만 넣는다. */
function seedFaq(db:Database,now:number):void{
 transaction(db,()=>{
  if(db.prepare('SELECT 1 FROM seed_runs WHERE name=?').get(FAQ_SEED))return;
  const insert=db.prepare("INSERT INTO faq_items(id,category,question,answer,status,position,created_at,updated_at) VALUES(?,?,?,?,'published',?,?,?)");
  for(const f of faqSeed.items)insert.run(randomUUID(),f.category,f.question,f.answer,f.position,now,now);
  db.prepare('INSERT INTO seed_runs(name,applied_at) VALUES(?,?)').run(FAQ_SEED,now);
 });
}

/** 캡처한 업데이트 23건을 한 번만 넣는다. 같은 날짜 항목은 캡처 순서(position)를 유지한다. */
function seedUpdates(db:Database,now:number):void{
 transaction(db,()=>{
  if(db.prepare('SELECT 1 FROM seed_runs WHERE name=?').get(UPDATES_SEED))return;
  const insert=db.prepare(`INSERT INTO site_updates(id,slug,version_label,types_json,title,summary,body_markdown,published_on,status,position,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,'published',?,?,?) ON CONFLICT(slug) DO NOTHING`);
  updatesSeed.updates.forEach((u,i)=>insert.run(randomUUID(),u.slug,u.versionLabel,JSON.stringify(u.types),u.title,u.summary,u.bodyMarkdown,u.publishedOn,i,now,now));
  db.prepare('INSERT INTO seed_runs(name,applied_at) VALUES(?,?)').run(UPDATES_SEED,now);
 });
}
