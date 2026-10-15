import {z} from 'zod';
import {paginationInput,version} from '../validation';

/** 사이트 안 경로(/로 시작, //는 다른 사이트라 거절) 또는 https 주소만 허용한다. */
const linkUrl=z.union([
 z.literal(''),
 z.string().trim().max(300).regex(/^\/(?!\/)[^\s\\]*$/,'링크는 /로 시작하는 사이트 경로 또는 https 주소만 쓸 수 있습니다.'),
 z.url().max(300).refine(v=>{try{return new URL(v).protocol==='https:';}catch{return false;}},'링크는 https 주소만 쓸 수 있습니다.')
]);
const imageUrl=linkUrl.refine(v=>v.length>0,'이미지 주소가 필요합니다.');
const ratio=z.string().trim().regex(/^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/).refine(v=>v.split('/').every(n=>Number(n)>0&&Number(n)<=10000),'비율은 양수 / 양수로 입력해주세요.');
export const announcementMetadataInput=z.object({
 couponCode:z.string().trim().min(1).max(120).optional(),
 image:imageUrl.optional(),imageMobile:imageUrl.optional(),ratio:ratio.optional(),ratioMobile:ratio.optional(),
 display:z.enum(['notice','banner','ticker']).optional(),
 exactPath:z.string().max(300).regex(/^\/(?!\/)[^\s\\?#]*$/).optional(),
 ctaLabel:z.string().trim().min(1).max(30).optional(),
}).strict().refine(v=>v.display!=='banner'||!!v.image,'이미지 배너에는 기본 이미지가 필요합니다.');
const at=z.iso.datetime({offset:true}).nullable();
const fields={
 type:z.enum(['coupon','feature','maintenance','event','blog']),
 metadata:announcementMetadataInput,
 title:z.string().trim().min(1).max(80),
 body:z.string().trim().max(300),
 linkUrl,
 linkLabel:z.string().trim().max(30),
 target:z.enum(['landing','all','dashboard']),
 startsAt:at,
 endsAt:at,
 status:z.enum(['draft','published']),
};
type Shape={type?:string;metadata?:z.infer<typeof announcementMetadataInput>;linkUrl?:string;linkLabel?:string;startsAt?:string|null;endsAt?:string|null};
const consistent=(v:Shape)=>!(v.linkUrl&&v.linkLabel===''&&!(['coupon','feature','blog'].includes(v.type??'')||v.metadata?.display==='ticker'||(v.metadata?.image&&v.metadata.display!=='notice')))&&!(v.startsAt&&v.endsAt&&Date.parse(v.endsAt)<=Date.parse(v.startsAt));
const message='링크를 넣으면 링크 문구도 필요하고, 종료 시각은 시작 시각보다 뒤여야 합니다.';
export const createAnnouncementInput=z.object({
 ...fields,type:fields.type.default('maintenance'),metadata:announcementMetadataInput.default({}),body:fields.body.default(''),linkUrl:linkUrl.default(''),linkLabel:fields.linkLabel.default(''),target:fields.target.default('landing'),
 startsAt:at.default(null),endsAt:at.default(null),status:fields.status.default('draft')
}).strict().refine(consistent,message);
export const updateAnnouncementInput=z.object(fields).partial().extend({version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
export const announcementQueryInput=paginationInput.extend({status:z.enum(['draft','published']).optional()});
export {consistent as announcementConsistent,message as announcementConsistencyMessage};
