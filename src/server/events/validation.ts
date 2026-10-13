import {z} from 'zod';
import {paginationInput,version} from '../validation';

const time=z.string().datetime({offset:true}).transform(v=>Date.parse(v));
export const eventFields={
 slug:z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,59}$/,'주소는 영문 소문자·숫자·하이픈 2~60자로 입력해주세요.'),
 title:z.string().trim().min(1).max(100),
 summary:z.string().trim().max(300),
 body:z.string().max(20000),
 status:z.enum(['draft','published','closed']),
 startsAt:time,
 endsAt:time,
 requiresProof:z.boolean(),
 rewardTokens:z.number().int().min(0).max(10000),
 acceptsEntries:z.boolean(),
 ctaLabel:z.string().trim().max(40),
 ctaHref:z.union([z.literal(''),z.string().trim().max(200).regex(/^\/(?!\/)[^\s\\]*$/,'버튼 링크는 이 사이트 안의 경로(/로 시작)만 쓸 수 있습니다.')]),
};
export const createEventInput=z.object({...eventFields,summary:eventFields.summary.default(''),body:eventFields.body.default(''),
 status:eventFields.status.default('draft'),requiresProof:eventFields.requiresProof.default(true),rewardTokens:eventFields.rewardTokens.default(0),
 acceptsEntries:eventFields.acceptsEntries.default(true),ctaLabel:eventFields.ctaLabel.default(''),ctaHref:eventFields.ctaHref.default('')})
 .strict().refine(v=>v.endsAt>v.startsAt,{message:'종료 시각은 시작 시각보다 늦어야 합니다.',path:['endsAt']});
export const updateEventInput=z.object(eventFields).partial().extend({version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
export const eventQueryInput=paginationInput.extend({status:z.enum(['draft','published','closed']).optional()});

/** 참여 인증 글: 네이버 블로그 글 주소(blog.naver.com/{id}/{글번호} 또는 PostView.naver?blogId=&logNo=). */
export function parseProofUrl(raw:string):{naverId:string;logNo:string;url:string}|null{
 let u:URL;
 try{u=new URL(raw);}catch{return null;}
 if(u.protocol!=='https:'&&u.protocol!=='http:')return null;
 if(!['blog.naver.com','m.blog.naver.com'].includes(u.hostname))return null;
 const parts=u.pathname.split('/').filter(Boolean);
 const [naverId,logNo]=parts.length===2?parts:/^PostView\.(naver|nhn)$/.test(parts[0]??'')?[u.searchParams.get('blogId')??'',u.searchParams.get('logNo')??'']:['',''];
 if(!/^[a-z0-9][a-z0-9_-]{1,49}$/i.test(naverId)||!/^\d{1,20}$/.test(logNo))return null;
 const id=naverId.toLowerCase();
 return{naverId:id,logNo,url:`https://blog.naver.com/${id}/${logNo}`};
}
const proofUrl=z.string().trim().max(300).refine(v=>parseProofUrl(v)!==null,'네이버 블로그 글 주소(blog.naver.com/아이디/글번호)를 입력해주세요.');
const note=z.string().trim().max(500);
export const submitEntryInput=z.object({proofUrl:proofUrl.optional(),note:note.default('')}).strict();
export const updateEntryInput=z.object({proofUrl:proofUrl.optional(),note:note.optional(),version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
export const reviewInput=z.object({decision:z.enum(['approved','rejected']),note:z.string().trim().max(300).default(''),version}).strict();
export const entryQueryInput=paginationInput.extend({status:z.enum(['submitted','approved','rejected','withdrawn']).optional()});
const eventSlug=z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,59}$/);
/** 토큰 리워드(tokens) 또는 상품·쿠폰 리워드(item, 토큰 없음) 중 하나. eventSlug를 주면 그 이벤트 당첨 내역에 표시된다. */
export const grantRewardInput=z.object({userId:z.string().min(1).max(60).optional(),email:z.string().trim().toLowerCase().email().max(254).optional(),
 tokens:z.number().int().min(1).max(100000).optional(),item:z.string().trim().min(1).max(100).optional(),description:z.string().trim().min(1).max(200),eventSlug:eventSlug.optional()}).strict()
 .refine(v=>!!v.userId!==!!v.email,'받을 회원(id 또는 이메일) 하나를 지정해주세요.')
 .refine(v=>(v.tokens===undefined)!==(v.item===undefined),'토큰 수 또는 상품명 중 하나를 입력해주세요.');
export const rankingRewardInput=z.object({period:z.enum(['week','month']),offset:z.number().int().min(-52).max(-1),top:z.number().int().min(1).max(100),tokens:z.number().int().min(1).max(100000),eventSlug:eventSlug.optional()}).strict();
export const rewardQueryInput=paginationInput.extend({status:z.enum(['granted','revoked']).optional(),kind:z.enum(['event','ranking','manual','gift']).optional()});
