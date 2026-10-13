import {z} from 'zod';
import {paginationInput,version} from '../validation';
import {MAX_MARKDOWN} from './markdown';
import {slug} from './validation';
import {UPDATE_TYPES} from './updates';

const isoDate=z.iso.date();
export const updateFields={
 slug,
 versionLabel:z.string().trim().max(20),
 types:z.array(z.enum(UPDATE_TYPES)).min(1).max(4).refine(v=>new Set(v).size===v.length,'같은 분류를 두 번 넣을 수 없습니다.'),
 title:z.string().trim().min(1).max(200),
 summary:z.string().trim().max(500),
 bodyMarkdown:z.string().max(MAX_MARKDOWN),
 publishedOn:isoDate,
 status:z.enum(['draft','published']),
 position:z.number().int().min(-10000).max(10000),
};
export const createUpdateInput=z.object({
 ...updateFields,versionLabel:updateFields.versionLabel.default(''),summary:updateFields.summary.default(''),bodyMarkdown:updateFields.bodyMarkdown.default(''),
 status:updateFields.status.default('draft'),position:updateFields.position.default(0)
}).strict();
export const updateUpdateInput=z.object(updateFields).partial().extend({version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
export const updateQueryInput=paginationInput.extend({status:z.enum(['draft','published']).optional(),type:z.enum(UPDATE_TYPES).optional()});
