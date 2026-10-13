import type {Database} from '../database';

export const UPDATE_TYPES=['feature','improvement','fix','design'] as const;
export type UpdateType=typeof UPDATE_TYPES[number];
export const UPDATE_TYPE_LABELS:Record<UpdateType,string>={feature:'새 기능',improvement:'개선',fix:'버그 수정',design:'디자인'};
/** 공개 화면 필터에 나오는 분류(원본과 같이 디자인은 필터 없이 칩으로만 표시). */
export const FILTER_TYPES:UpdateType[]=['feature','improvement','fix'];
export type UpdateStatus='draft'|'published';
export type SiteUpdate={id:string;slug:string;versionLabel:string;types:UpdateType[];title:string;summary:string;bodyMarkdown:string;publishedOn:string;status:UpdateStatus;position:number;version:number;createdAt:number;updatedAt:number};

type Row={id:string;slug:string;version_label:string;types_json:string;title:string;summary:string;body_markdown:string;published_on:string;status:UpdateStatus;position:number;version:number;created_at:number;updated_at:number};
export type UpdateRow=Row;
export const UPDATE_SELECT='SELECT id,slug,version_label,types_json,title,summary,body_markdown,published_on,status,position,version,created_at,updated_at FROM site_updates';
export const UPDATE_ORDER='ORDER BY published_on DESC,position,created_at DESC';
export const toUpdate=(r:Row):SiteUpdate=>({
 id:r.id,slug:r.slug,versionLabel:r.version_label,types:JSON.parse(r.types_json) as UpdateType[],title:r.title,summary:r.summary,bodyMarkdown:r.body_markdown,
 publishedOn:r.published_on,status:r.status,position:r.position,version:r.version,createdAt:r.created_at,updatedAt:r.updated_at
});

export function listPublishedUpdates(db:Database):SiteUpdate[]{
 return (db.prepare(`${UPDATE_SELECT} WHERE status='published' ${UPDATE_ORDER}`).all() as Row[]).map(toUpdate);
}
