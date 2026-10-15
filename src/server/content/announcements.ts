import type {Database} from '../database';

export type AnnouncementMetadata={image?:string;imageMobile?:string;ratio?:string;ratioMobile?:string;display?:'notice'|'banner';exactPath?:string;ctaLabel?:string};
export type AnnouncementTarget='landing'|'all';
export type Announcement={id:string;metadata:AnnouncementMetadata;title:string;body:string;linkUrl:string;linkLabel:string;target:AnnouncementTarget;startsAt:number|null;endsAt:number|null;status:'draft'|'published';version:number;createdAt:number;updatedAt:number};
/** 방문자에게 보여줄 최소 필드(작성자·상태 등 내부 정보 제외). */
export type PublicAnnouncement=Pick<Announcement,'id'|'title'|'body'|'linkUrl'|'linkLabel'|'version'|'metadata'>;
export const ANNOUNCEMENT_SELECT=`SELECT id,metadata,title,body,link_url AS linkUrl,link_label AS linkLabel,target,starts_at AS startsAt,ends_at AS endsAt,status,version,created_at AS createdAt,updated_at AS updatedAt FROM announcements`;
export type AnnouncementRow=Omit<Announcement,'metadata'>&{metadata:string};
export const plainAnnouncement=(a:AnnouncementRow):Announcement=>({...a,metadata:JSON.parse(a.metadata)});

/** 공지는 공개 화면에만 보인다(대시보드·관리자·로그인 화면 제외). */
const isPublicPath=(path:string)=>!/^\/(dashboard|admin|login|auth|api|oauth|payment)(\/|$)/.test(path);

/** 지금 이 경로에 띄울 공지 1건. 공개 상태·기간·대상이 맞는 것 중 가장 최근 수정된 것. */
export function activeAnnouncement(db:Database,path:string,now=Date.now()):PublicAnnouncement|null{
 if(!isPublicPath(path))return null;
 const targets=path==='/'?['landing','all']:['all'];
 const r=db.prepare(`${ANNOUNCEMENT_SELECT} WHERE status='published' AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?)
  AND (json_extract(metadata,'$.exactPath') IS NULL OR json_extract(metadata,'$.exactPath')='' OR json_extract(metadata,'$.exactPath')=?)
  AND target IN (${targets.map(()=>'?').join(',')}) ORDER BY updated_at DESC,id LIMIT 1`).get(now,now,path,...targets) as AnnouncementRow|undefined;
 return r?{metadata:plainAnnouncement(r).metadata,id:r.id,title:r.title,body:r.body,linkUrl:r.linkUrl,linkLabel:r.linkLabel,version:r.version}:null;
}
