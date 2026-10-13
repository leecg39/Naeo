import {z} from 'zod';
import {paginationInput,version} from '../validation';

const time=z.string().datetime({offset:true}).transform(v=>Date.parse(v));
export const planFields={
 code:z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,29}$/,'코드는 영문 소문자·숫자·하이픈 2~30자로 입력해주세요.'),
 name:z.string().trim().min(1).max(40),
 description:z.string().trim().max(300),
 price:z.number().int().min(0).max(10_000_000),
 monthlyTokens:z.number().int().min(0).max(1_000_000),
 trialDays:z.number().int().min(0).max(30),
 status:z.enum(['active','hidden']),
 position:z.number().int().min(-1000).max(1000),
};
export const createPlanInput=z.object({...planFields,description:planFields.description.default(''),monthlyTokens:planFields.monthlyTokens.default(0),
 trialDays:planFields.trialDays.default(0),status:planFields.status.default('active'),position:planFields.position.default(0)}).strict();
export const updatePlanInput=z.object(planFields).partial().extend({version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');

const code=z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{3,31}$/,'쿠폰 코드는 영문·숫자·하이픈 4~32자입니다.');
export const couponFields={
 code,
 kind:z.enum(['tokens','percent_off','amount_off']),
 value:z.number().int().min(1).max(10_000_000),
 planCode:z.string().trim().max(30).nullable(),
 maxRedemptions:z.number().int().min(1).max(1_000_000).nullable(),
 startsAt:time,
 endsAt:time,
 status:z.enum(['active','disabled']),
 note:z.string().trim().max(200),
};
export const createCouponInput=z.object({...couponFields,planCode:couponFields.planCode.default(null),maxRedemptions:couponFields.maxRedemptions.default(null),
 status:couponFields.status.default('active'),note:couponFields.note.default('')}).strict()
 .refine(v=>v.endsAt>v.startsAt,{message:'종료 시각은 시작 시각보다 늦어야 합니다.',path:['endsAt']})
 .refine(v=>v.kind!=='percent_off'||v.value<=100,{message:'할인율은 100% 이하입니다.',path:['value']});
export const updateCouponInput=z.object({status:couponFields.status,note:couponFields.note,maxRedemptions:couponFields.maxRedemptions,endsAt:time}).partial().extend({version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
export const couponQueryInput=paginationInput.extend({status:z.enum(['active','disabled']).optional()});
export const redeemInput=z.object({code:z.string().trim().min(1).max(40)}).strict();

export const trialInput=z.object({planCode:planFields.code}).strict();
export const versionInput=z.object({version}).strict();
export const checkoutInput=z.object({planCode:planFields.code,couponCode:z.string().trim().max(40).optional()}).strict();
export const confirmInput=z.object({paymentKey:z.string().min(1).max(200),orderId:z.string().regex(/^[A-Za-z0-9_-]{6,64}$/),amount:z.coerce.number().int().min(0).max(10_000_000)}).strict();
export const refundRequestInput=z.object({reason:z.string().trim().min(1).max(300)}).strict();
export const refundDecisionInput=z.object({decision:z.enum(['approved','rejected']),note:z.string().trim().max(300).default(''),version}).strict();
export const adminRefundInput=z.object({amount:z.number().int().min(1).max(10_000_000).optional(),reason:z.string().trim().min(1).max(300)}).strict();
export const paymentQueryInput=paginationInput.extend({status:z.enum(['ready','paid','failed','expired','canceled','partial_canceled']).optional()});
export const refundQueryInput=paginationInput.extend({status:z.enum(['requested','approved','rejected','completed','failed']).optional()});
