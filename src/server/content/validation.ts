import {z} from 'zod';
import {paginationInput,version} from '../validation';
import {MAX_MARKDOWN} from './markdown';

export const slug=z.string().trim().regex(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/,'주소는 영문 소문자·숫자·하이픈(-)으로 입력해주세요.');
const coverImage=z.union([
 z.literal(''),
 z.string().trim().regex(/^\/assets\/[A-Za-z0-9._-]+$/,'이미지는 /assets/ 경로 또는 https 주소만 사용할 수 있습니다.'),
 z.url().max(300).refine(v=>new URL(v).protocol==='https:','이미지는 https 주소만 사용할 수 있습니다.')
]);
const tags=z.array(z.string().trim().min(1).max(30)).max(10).refine(v=>new Set(v).size===v.length,'같은 태그를 두 번 넣을 수 없습니다.');
const publishedAt=z.iso.datetime({offset:true}).nullable();

export const articleFields={
 categoryId:z.uuid(),
 slug,
 title:z.string().trim().min(1).max(200),
 summary:z.string().trim().max(500),
 showSummary:z.boolean(),
 bodyMarkdown:z.string().max(MAX_MARKDOWN),
 tags,
 coverImage,
 featured:z.boolean(),
 status:z.enum(['draft','published','archived']),
 publishedAt,
 readMinutes:z.number().int().min(1).max(600),
 position:z.number().int().min(-10000).max(10000),
};
export const createArticleInput=z.object({
 ...articleFields,
 summary:articleFields.summary.default(''),showSummary:articleFields.showSummary.default(true),bodyMarkdown:articleFields.bodyMarkdown.default(''),
 tags:tags.default([]),coverImage:coverImage.default(''),featured:articleFields.featured.default(false),status:articleFields.status.default('draft'),
 publishedAt:publishedAt.optional(),readMinutes:articleFields.readMinutes.optional(),position:articleFields.position.default(0)
}).strict();
export const updateArticleInput=z.object(articleFields).partial().extend({version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
export const restoreRevisionInput=z.object({revision:z.number().int().positive(),version}).strict();
export const previewInput=z.object({bodyMarkdown:articleFields.bodyMarkdown}).strict();
export const articleQueryInput=paginationInput.extend({status:z.enum(['draft','published','archived']).optional(),category:slug.optional()});

const categoryName=z.string().trim().min(1).max(30);
const sortOrder=z.number().int().min(-1000).max(1000);
export const createCategoryInput=z.object({slug,name:categoryName,sortOrder:sortOrder.default(0)}).strict();
export const updateCategoryInput=z.object({slug:slug.optional(),name:categoryName.optional(),sortOrder:sortOrder.optional(),version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
