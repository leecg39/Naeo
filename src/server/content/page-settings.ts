import {getCapturedPage} from '../../lib/pages';
import type {CapturedPageData} from '../../types/site';
import type {Database} from '../database';

/** 레이아웃이 곧 디자인인 고정 페이지. 본문은 캡처 그대로 두고 제목·설명·공개 여부만 관리한다. */
export const MANAGED_PAGES=['/features','/guide/writing','/guide/extension-publish'];
export type PageSetting={id:string;path:string;title:string;description:string;status:'published'|'hidden';version:number;createdAt:number;updatedAt:number};
export const PAGE_SETTING_SELECT='SELECT id,path,title,description,status,version,created_at AS createdAt,updated_at AS updatedAt FROM page_settings';
/** 캡처 제목 끝에 붙은 " | NAEO"를 떼어 관리자가 보는 제목으로 쓴다. */
export const displayTitle=(title:string)=>title.replace(/(?: \| NAEO)+$/,'');

export function pageSettingByPath(db:Database,path:string):PageSetting|null{
 const r=db.prepare(`${PAGE_SETTING_SELECT} WHERE path=?`).get(path) as PageSetting|undefined;
 return r?{...r}:null;
}

/** undefined: 관리 대상 아님, null: 숨김(404), 그 외: 캡처 본문 + 저장된 제목·설명. */
export async function resolveManagedPage(db:Database,path:string):Promise<CapturedPageData|null|undefined>{
 if(!MANAGED_PAGES.includes(path))return undefined;
 const setting=pageSettingByPath(db,path);
 const page=await getCapturedPage(path);
 if(!page)return undefined;
 if(!setting)return page;
 if(setting.status==='hidden')return null;
 return{...page,title:`${setting.title} | NAEO`,description:setting.description};
}
