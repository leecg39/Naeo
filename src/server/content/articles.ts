import type {Database} from '../database';

export type ArticleStatus='draft'|'published'|'archived';
export type CategoryRef={id:string;slug:string;name:string};
export type Article={
 id:string;slug:string;title:string;summary:string;showSummary:boolean;bodyMarkdown:string;tags:string[];coverImage:string;
 featured:boolean;status:ArticleStatus;publishedAt:number|null;readMinutes:number;position:number;version:number;
 createdAt:number;updatedAt:number;category:CategoryRef;url:string;
};
export type Category=CategoryRef&{sortOrder:number;version:number;publishedCount:number;articleCount:number};

type Row={id:string;slug:string;title:string;summary:string;show_summary:number;body_markdown:string;tags_json:string;cover_image:string;featured:number;status:ArticleStatus;published_at:number|null;read_minutes:number;position:number;version:number;created_at:number;updated_at:number;category_id:string;category_slug:string;category_name:string};

export const ARTICLE_SELECT=`SELECT a.id,a.slug,a.title,a.summary,a.show_summary,a.body_markdown,a.tags_json,a.cover_image,a.featured,a.status,a.published_at,a.read_minutes,a.position,a.version,a.created_at,a.updated_at,
 c.id AS category_id,c.slug AS category_slug,c.name AS category_name FROM articles a JOIN article_categories c ON c.id=a.category_id`;
export const PUBLIC_ORDER='ORDER BY a.published_at DESC,c.sort_order,a.position,a.created_at';
const PUBLISHED="a.status='published' AND a.published_at<=?";

export function toArticle(r:Row):Article{
 return{
  id:r.id,slug:r.slug,title:r.title,summary:r.summary,showSummary:r.show_summary===1,bodyMarkdown:r.body_markdown,tags:JSON.parse(r.tags_json) as string[],
  coverImage:r.cover_image,featured:r.featured===1,status:r.status,publishedAt:r.published_at,readMinutes:r.read_minutes,position:r.position,version:r.version,
  createdAt:r.created_at,updatedAt:r.updated_at,category:{id:r.category_id,slug:r.category_slug,name:r.category_name},url:`/blog/${r.category_slug}/${r.slug}`
 };
}

export function listPublishedArticles(db:Database,{category,now=Date.now()}:{category?:string;now?:number}):Article[]{
 const rows=category
  ?db.prepare(`${ARTICLE_SELECT} WHERE ${PUBLISHED} AND c.slug=? ${PUBLIC_ORDER}`).all(now,category)
  :db.prepare(`${ARTICLE_SELECT} WHERE ${PUBLISHED} ${PUBLIC_ORDER}`).all(now);
 return (rows as Row[]).map(toArticle);
}

export function getPublishedArticle(db:Database,category:string,slug:string,now=Date.now()):Article|null{
 const row=db.prepare(`${ARTICLE_SELECT} WHERE ${PUBLISHED} AND c.slug=? AND a.slug=?`).get(now,category,slug) as Row|undefined;
 return row?toArticle(row):null;
}

export function listCategories(db:Database,now=Date.now()):Category[]{
 const rows=db.prepare(`SELECT c.id,c.slug,c.name,c.sort_order,c.version,
  (SELECT count(*) FROM articles a WHERE a.category_id=c.id AND ${PUBLISHED}) AS published_count,
  (SELECT count(*) FROM articles a WHERE a.category_id=c.id) AS article_count
  FROM article_categories c ORDER BY c.sort_order,c.name`).all(now) as {id:string;slug:string;name:string;sort_order:number;version:number;published_count:number;article_count:number}[];
 return rows.map(r=>({id:r.id,slug:r.slug,name:r.name,sortOrder:r.sort_order,version:r.version,publishedCount:r.published_count,articleCount:r.article_count}));
}

/** /blog 화면 구성: 추천(featured) · 언론 보도(news) · 이벤트 강조(event 최신 1개) · 나머지 전체 글. */
export function blogIndexSections(db:Database,now=Date.now()){
 const all=listPublishedArticles(db,{now});
 const featured=all.filter(a=>a.featured);
 const news=all.filter(a=>!a.featured&&a.category.slug==='news');
 const events=all.filter(a=>!a.featured&&a.category.slug==='event');
 const rest=all.filter(a=>!a.featured&&a.category.slug!=='news'&&a.category.slug!=='event');
 return{all,featured,news,event:events[0]??null,rest};
}
