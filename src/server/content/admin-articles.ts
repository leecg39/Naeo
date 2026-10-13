import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {requireAdmin,userById} from '../auth';
import {audit} from '../audit';
import {AppError} from '../errors';
import {ARTICLE_SELECT,listCategories,toArticle,type Article,type Category} from './articles';
import {renderMarkdown} from './markdown';
import {articleQueryInput,createArticleInput,createCategoryInput,previewInput,restoreRevisionInput,updateArticleInput,updateCategoryInput} from './validation';
import {deleteInput} from '../validation';

type ArticleRow=Parameters<typeof toArticle>[0];
type Snapshot={categoryId:string;slug:string;title:string;summary:string;showSummary:boolean;bodyMarkdown:string;tags:string[];coverImage:string;featured:boolean;status:Article['status'];publishedAt:number|null;readMinutes:number;position:number};
export type Revision={version:number;createdAt:number;authorId:string|null};

const authorize=(db:Database,actorId:string)=>requireAdmin(userById(db,actorId));
/** 새 규칙(원본 미확인): 공백 제외 약 180자를 1분으로 본다. 시드 글은 원본 값을 유지한다. */
export const defaultReadMinutes=(text:string)=>Math.max(1,Math.round(text.replace(/\s+/g,'').length/180));

/** 저장 전에 본문을 렌더링해 차단된 주소·지원하지 않는 구성 요소·HTML이 있으면 거절한다. */
function checkedBody(markdown:string){
 const r=renderMarkdown(markdown);
 if(r.warnings.length)throw new AppError(400,'CONTENT_INVALID','본문에 허용되지 않은 내용이 있습니다.',r.warnings);
 return r;
}
function row(db:Database,id:string):Article{
 const r=db.prepare(`${ARTICLE_SELECT} WHERE a.id=?`).get(id) as ArticleRow|undefined;
 if(!r)throw new AppError(404,'NOT_FOUND','글을 찾을 수 없습니다.');
 return toArticle(r);
}
const snapshotOf=(a:Article):Snapshot=>({categoryId:a.category.id,slug:a.slug,title:a.title,summary:a.summary,showSummary:a.showSummary,bodyMarkdown:a.bodyMarkdown,tags:a.tags,coverImage:a.coverImage,featured:a.featured,status:a.status,publishedAt:a.publishedAt,readMinutes:a.readMinutes,position:a.position});
function saveRevision(db:Database,a:Article,authorId:string|null,now:number){
 db.prepare("INSERT INTO content_revisions(id,resource_type,resource_id,version,snapshot_json,author_id,created_at) VALUES(?,'article',?,?,?,?,?) ON CONFLICT DO NOTHING")
  .run(randomUUID(),a.id,a.version,JSON.stringify(snapshotOf(a)),authorId,now);
}
function assertCategory(db:Database,id:string){
 if(!db.prepare('SELECT 1 FROM article_categories WHERE id=?').get(id))throw new AppError(404,'CATEGORY_NOT_FOUND','분류를 찾을 수 없습니다.');
}
function assertSlugFree(db:Database,categoryId:string,slug:string,exceptId=''){
 if(db.prepare('SELECT 1 FROM articles WHERE category_id=? AND slug=? AND id<>?').get(categoryId,slug,exceptId))throw new AppError(409,'SLUG_EXISTS','같은 분류에 같은 주소의 글이 있습니다.');
}
const toMs=(iso:string|null|undefined)=>iso==null?null:Date.parse(iso);

export function listAdminArticles(db:Database,actorId:string,query:unknown){
 authorize(db,actorId);
 const {page,pageSize,q,status,category}=articleQueryInput.parse(query);
 const like=`%${q.replace(/[\\%_]/g,v=>'\\'+v)}%`;
 const where=["(a.title LIKE ? ESCAPE '\\' OR a.slug LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\')"],params:(string|number)[]=[like,like,like];
 if(status){where.push('a.status=?');params.push(status);}
 if(category){where.push('c.slug=?');params.push(category);}
 const sql=`FROM articles a JOIN article_categories c ON c.id=a.category_id WHERE ${where.join(' AND ')}`;
 const {total}=db.prepare(`SELECT count(*) AS total ${sql}`).get(...params) as {total:number};
 const rows=db.prepare(`${ARTICLE_SELECT} WHERE a.id IN (SELECT a.id ${sql}) ORDER BY a.updated_at DESC,a.id LIMIT ? OFFSET ?`).all(...params,pageSize,(page-1)*pageSize) as ArticleRow[];
 return{data:rows.map(toArticle),pagination:{page,pageSize,total}};
}

export function getAdminArticle(db:Database,actorId:string,id:string):Article&{revisions:Revision[]}{
 authorize(db,actorId);
 const a=row(db,id);
 const revisions=db.prepare("SELECT version,created_at AS createdAt,author_id AS authorId FROM content_revisions WHERE resource_type='article' AND resource_id=? ORDER BY version DESC").all(id) as Revision[];
 return{...a,revisions};
}

export function createArticle(db:Database,actorId:string,input:unknown):Article{
 authorize(db,actorId);
 const v=createArticleInput.parse(input);
 const body=checkedBody(v.bodyMarkdown);
 const now=Date.now(),id=randomUUID();
 const publishedAt=toMs(v.publishedAt)??(v.status==='published'?now:null);
 return transaction(db,()=>{
  assertCategory(db,v.categoryId);assertSlugFree(db,v.categoryId,v.slug);
  db.prepare(`INSERT INTO articles(id,category_id,slug,title,summary,show_summary,body_markdown,tags_json,cover_image,featured,status,published_at,read_minutes,position,created_by,updated_by,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,v.categoryId,v.slug,v.title,v.summary,v.showSummary?1:0,v.bodyMarkdown,JSON.stringify(v.tags),v.coverImage,v.featured?1:0,v.status,publishedAt,v.readMinutes??defaultReadMinutes(body.text),v.position,actorId,actorId,now,now);
  const created=row(db,id);
  saveRevision(db,created,actorId,now);
  audit(db,actorId,'content.article.create','article',id,{status:v.status});
  return created;
 });
}

const COLUMNS:Record<string,string>={categoryId:'category_id',slug:'slug',title:'title',summary:'summary',showSummary:'show_summary',bodyMarkdown:'body_markdown',tags:'tags_json',coverImage:'cover_image',featured:'featured',status:'status',publishedAt:'published_at',readMinutes:'read_minutes',position:'position'};
function dbValue(key:string,value:unknown):string|number|null{
 if(key==='tags')return JSON.stringify(value);
 if(typeof value==='boolean')return value?1:0;
 if(key==='publishedAt')return toMs(value as string|null);
 return value as string|number;
}
/** 바뀐 필드만 낙관적 잠금(version)으로 갱신하고, 갱신 전·후 버전을 수정 이력에 남긴다. */
function applyUpdate(db:Database,actorId:string,id:string,changes:Record<string,unknown>,expected:number,action:string):Article{
 const now=Date.now();
 return transaction(db,()=>{
  const current=row(db,id);
  if(current.version!==expected)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  const next={...snapshotOf(current),...changes} as Snapshot&Record<string,unknown>;
  if(changes.categoryId!==undefined)assertCategory(db,next.categoryId);
  if(changes.categoryId!==undefined||changes.slug!==undefined)assertSlugFree(db,next.categoryId,next.slug,id);
  const fields={...changes};
  if(next.status==='published'&&next.publishedAt==null)fields.publishedAt=new Date(now).toISOString();
  saveRevision(db,current,null,current.updatedAt);
  const keys=Object.keys(fields);
  db.prepare(`UPDATE articles SET ${keys.map(k=>COLUMNS[k]+'=?').join(',')},version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=?`)
   .run(...keys.map(k=>dbValue(k,fields[k])),actorId,now,id,expected);
  const updated=row(db,id);
  saveRevision(db,updated,actorId,now);
  audit(db,actorId,action,'article',id,{fields:keys,version:updated.version});
  return updated;
 });
}

export function updateArticle(db:Database,actorId:string,id:string,input:unknown):Article{
 authorize(db,actorId);
 const {version,...changes}=updateArticleInput.parse(input);
 // 본문이 바뀌면 읽는 시간을 다시 계산한다(직접 입력한 값이 있으면 그 값을 쓴다).
 const body=changes.bodyMarkdown===undefined?null:checkedBody(changes.bodyMarkdown);
 const fields=body&&changes.readMinutes===undefined?{...changes,readMinutes:defaultReadMinutes(body.text)}:changes;
 return applyUpdate(db,actorId,id,fields,version,'content.article.update');
}

export function deleteArticle(db:Database,actorId:string,id:string,input:unknown){
 authorize(db,actorId);
 const {version}=deleteInput.parse(input);
 return transaction(db,()=>{
  const current=row(db,id);
  if(current.version!==version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  db.prepare('DELETE FROM articles WHERE id=? AND version=?').run(id,version);
  audit(db,actorId,'content.article.delete','article',id,{slug:current.slug,category:current.category.slug});
  return{deleted:true};
 });
}

/** 지난 버전의 내용(주소·제목·본문 등)을 새 버전으로 되돌린다. 공개 상태·게시일·추천·순서는 현재 값을 유지한다. */
export function restoreArticleRevision(db:Database,actorId:string,id:string,input:unknown):Article{
 authorize(db,actorId);
 const {revision,version}=restoreRevisionInput.parse(input);
 const snap=db.prepare("SELECT snapshot_json FROM content_revisions WHERE resource_type='article' AND resource_id=? AND version=?").get(id,revision) as {snapshot_json:string}|undefined;
 if(!snap)throw new AppError(404,'REVISION_NOT_FOUND','해당 버전을 찾을 수 없습니다.');
 const s=JSON.parse(snap.snapshot_json) as Snapshot;
 const content={categoryId:s.categoryId,slug:s.slug,title:s.title,summary:s.summary,showSummary:s.showSummary,bodyMarkdown:s.bodyMarkdown,tags:s.tags,coverImage:s.coverImage,readMinutes:s.readMinutes};
 return applyUpdate(db,actorId,id,content,version,'content.article.restore');
}

export function previewMarkdown(input:unknown){
 const {bodyMarkdown}=previewInput.parse(input);
 const r=renderMarkdown(bodyMarkdown);
 return{headings:r.headings,warnings:r.warnings,readMinutes:defaultReadMinutes(r.text)};
}

const categoryRow=(db:Database,id:string):Category=>{
 const c=listCategories(db).find(x=>x.id===id);
 if(!c)throw new AppError(404,'CATEGORY_NOT_FOUND','분류를 찾을 수 없습니다.');
 return c;
};
function assertCategorySlugFree(db:Database,slug:string,exceptId=''){
 if(db.prepare('SELECT 1 FROM article_categories WHERE slug=? AND id<>?').get(slug,exceptId))throw new AppError(409,'SLUG_EXISTS','같은 주소의 분류가 있습니다.');
}
export function listAdminCategories(db:Database,actorId:string):Category[]{authorize(db,actorId);return listCategories(db);}
export function createCategory(db:Database,actorId:string,input:unknown):Category{
 authorize(db,actorId);
 const v=createCategoryInput.parse(input);
 return transaction(db,()=>{
  assertCategorySlugFree(db,v.slug);
  const id=randomUUID(),now=Date.now();
  db.prepare('INSERT INTO article_categories(id,slug,name,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,v.slug,v.name,v.sortOrder,now,now);
  audit(db,actorId,'content.category.create','category',id,{slug:v.slug});
  return categoryRow(db,id);
 });
}
export function updateCategory(db:Database,actorId:string,id:string,input:unknown):Category{
 authorize(db,actorId);
 const {version,...v}=updateCategoryInput.parse(input);
 return transaction(db,()=>{
  const current=categoryRow(db,id);
  if(current.version!==version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  if(v.slug!==undefined)assertCategorySlugFree(db,v.slug,id);
  db.prepare('UPDATE article_categories SET slug=coalesce(?,slug),name=coalesce(?,name),sort_order=coalesce(?,sort_order),version=version+1,updated_at=? WHERE id=? AND version=?')
   .run(v.slug??null,v.name??null,v.sortOrder??null,Date.now(),id,version);
  audit(db,actorId,'content.category.update','category',id,{fields:Object.keys(v)});
  return categoryRow(db,id);
 });
}
export function deleteCategory(db:Database,actorId:string,id:string,input:unknown){
 authorize(db,actorId);
 const {version}=deleteInput.parse(input);
 return transaction(db,()=>{
  const current=categoryRow(db,id);
  if(current.version!==version)throw new AppError(409,'VERSION_CONFLICT','다른 곳에서 먼저 수정했습니다. 최신 내용을 불러와주세요.');
  if(current.articleCount>0)throw new AppError(409,'CATEGORY_IN_USE',`이 분류에 글 ${current.articleCount}개가 있어 삭제할 수 없습니다. 글을 다른 분류로 옮긴 뒤 삭제해주세요.`);
  db.prepare('DELETE FROM article_categories WHERE id=? AND version=?').run(id,version);
  audit(db,actorId,'content.category.delete','category',id,{slug:current.slug});
  return{deleted:true};
 });
}
