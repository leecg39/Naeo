import {z} from 'zod';
import {paginationInput,version} from '../validation';

const nonBlank=(max:number)=>z.string().trim().min(1).max(max);
export const faqFields={
 category:nonBlank(40),
 question:nonBlank(200),
 answer:z.string().max(5000).refine(v=>v.trim().length>0,'답변을 입력해주세요.'),
 status:z.enum(['draft','published']),
 position:z.number().int().min(-10000).max(10000),
};
export const createFaqInput=z.object({...faqFields,status:faqFields.status.default('draft'),position:faqFields.position.default(0)}).strict();
export const updateFaqInput=z.object(faqFields).partial().extend({version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
export const faqQueryInput=paginationInput.extend({status:z.enum(['draft','published']).optional(),category:z.string().trim().max(40).optional()});
