import {z} from 'zod';
import {paginationInput,version} from '../validation';

/** 사이트 안 경로(/로 시작, //는 다른 사이트라 거절) 또는 https 주소만 허용한다. */
const linkUrl=z.union([
 z.literal(''),
 z.string().trim().max(300).regex(/^\/(?!\/)[^\s]*$/,'링크는 /로 시작하는 사이트 경로 또는 https 주소만 쓸 수 있습니다.'),
 z.url().max(300).refine(v=>{try{return new URL(v).protocol==='https:';}catch{return false;}},'링크는 https 주소만 쓸 수 있습니다.')
]);
const at=z.iso.datetime({offset:true}).nullable();
const fields={
 title:z.string().trim().min(1).max(80),
 body:z.string().trim().max(300),
 linkUrl,
 linkLabel:z.string().trim().max(30),
 target:z.enum(['landing','all']),
 startsAt:at,
 endsAt:at,
 status:z.enum(['draft','published']),
};
type Shape={linkUrl?:string;linkLabel?:string;startsAt?:string|null;endsAt?:string|null};
const consistent=(v:Shape)=>!(v.linkUrl&&v.linkLabel==='')&&!(v.startsAt&&v.endsAt&&Date.parse(v.endsAt)<=Date.parse(v.startsAt));
const message='링크를 넣으면 링크 문구도 필요하고, 종료 시각은 시작 시각보다 뒤여야 합니다.';
export const createAnnouncementInput=z.object({
 ...fields,body:fields.body.default(''),linkUrl:linkUrl.default(''),linkLabel:fields.linkLabel.default(''),target:fields.target.default('landing'),
 startsAt:at.default(null),endsAt:at.default(null),status:fields.status.default('draft')
}).strict().refine(consistent,message);
export const updateAnnouncementInput=z.object(fields).partial().extend({version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
export const announcementQueryInput=paginationInput.extend({status:z.enum(['draft','published']).optional()});
export {consistent as announcementConsistent,message as announcementConsistencyMessage};
