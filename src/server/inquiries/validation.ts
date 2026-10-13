import {z} from 'zod';
import {email,paginationInput,version} from '../validation';

/** 원본 /contact 문의 유형 select의 value 목록과 같다. */
export const INQUIRY_TYPES=['service','technical','business','partnership','etc'] as const;
export const INQUIRY_STATUSES=['open','answered','closed'] as const;

const type=z.enum(INQUIRY_TYPES);
const subject=z.string().trim().max(200);
const message=z.string().trim().min(1,'문의 내용을 입력해주세요.').max(5000);
const replyBody=z.string().trim().min(1,'답변 내용을 입력해주세요.').max(10000);

export const createInquiryInput=z.object({type:type.default('etc'),email,subject:subject.default(''),message}).strict();
export const updateInquiryInput=z.object({type:type.optional(),subject:subject.optional(),message:message.optional(),version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
export const inquiryQueryInput=paginationInput.extend({status:z.enum(INQUIRY_STATUSES).optional(),type:type.optional()});
export const inquiryStatusInput=z.object({status:z.enum(INQUIRY_STATUSES),version}).strict();
export const replyInput=z.object({body:replyBody,version}).strict();

const templateName=z.string().trim().min(1).max(60);
export const createTemplateInput=z.object({name:templateName,subject:subject.default(''),body:replyBody}).strict();
export const updateTemplateInput=z.object({name:templateName.optional(),subject:subject.optional(),body:replyBody.optional(),version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
