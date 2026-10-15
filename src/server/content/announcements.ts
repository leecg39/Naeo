import type {Database} from '../database';

export type AnnouncementMetadata={image?:string;imageMobile?:string;ratio?:string;ratioMobile?:string;display?:'notice'|'banner';exactPath?:string;ctaLabel?:string};
export type AnnouncementTarget='landing'|'all'|'dashboard';
export type Announcement={id:string;metadata:AnnouncementMetadata;title:string;body:string;linkUrl:string;linkLabel:string;target:AnnouncementTarget;startsAt:number|null;endsAt:number|null;status:'draft'|'published';version:number;createdAt:number;updatedAt:number};
/** 방문자에게 보여줄 최소 필드(작성자·상태 등 내부 정보 제외). */
export type PublicAnnouncement=Pick<Announcement,'id'|'title'|'body'|'linkUrl'|'linkLabel'|'version'|'metadata'>;
export const ANNOUNCEMENT_SELECT=`SELECT id,metadata,title,body,link_url AS linkUrl,link_label AS linkLabel,target,starts_at AS startsAt,ends_at AS endsAt,status,version,created_at AS createdAt,updated_at AS updatedAt FROM announcements`;
export type AnnouncementRow=Omit<Announcement,'metadata'>&{metadata:string};
export const plainAnnouncement=(a:AnnouncementRow):Announcement=>({...a,metadata:JSON.parse(a.metadata)});

/** 관리자·인증·결제 화면에는 공지를 표시하지 않는다. */
const isPublicPath=(path:string)=>!/^\/(admin|login|auth|api|oauth|payment)(\/|$)/.test(path);

/** 게시 기간과 대상이 맞는 공지 목록. 수정 시각 내림차순은 클론의 명시적 정렬 정책이다. */
export function activeAnnouncements(db:Database,path:string,now=Date.now()):PublicAnnouncement[]{
 if(!isPublicPath(path))return [];
 const targets=/^\/dashboard(?:\/|$)/.test(path)?['dashboard']:['landing','all'];
 const rows=db.prepare(`${ANNOUNCEMENT_SELECT} WHERE status='published' AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?)
  AND (json_extract(metadata,'$.exactPath') IS NULL OR json_extract(metadata,'$.exactPath')='' OR json_extract(metadata,'$.exactPath')=?)
  AND target IN (${targets.map(()=>'?').join(',')}) ORDER BY updated_at DESC,id`).all(now,now,path,...targets) as AnnouncementRow[];
 return rows.map(r=>({metadata:plainAnnouncement(r).metadata,id:r.id,title:r.title,body:r.body,linkUrl:r.linkUrl,linkLabel:r.linkLabel,version:r.version}));
}

/** 기존 단일 조회 호출자를 위한 첫 항목 조회. 화면에서는 전체 목록을 사용한다. */
export function activeAnnouncement(db:Database,path:string,now=Date.now()):PublicAnnouncement|null{return activeAnnouncements(db,path,now)[0]??null;}
