import {z} from 'zod';
import {paginationInput,version} from '../validation';

const SEGMENT='[a-z0-9]+(?:-[a-z0-9]+)*';
/** 다른 화면이나 API가 쓰는 첫 경로. 문서가 이 주소를 차지하면 기존 화면을 가리게 된다. */
export const RESERVED_ROOTS=['api','admin','dashboard','login','auth','blog','updates','assets','_next','p','oauth','payment','social','dev','event','mate','preview'];

export const documentPath=z.string().trim()
 .regex(new RegExp(`^/${SEGMENT}(?:/${SEGMENT}){0,2}$`),'주소는 /로 시작하는 영문 소문자·숫자·하이픈(-) 경로로 입력해주세요. 예: /youth-policy')
 .max(80);
export const documentFields={
 path:documentPath,
 title:z.string().trim().min(1).max(120),
 effectiveLabel:z.string().trim().max(120),
 body:z.string().max(100000),
 closingNote:z.string().max(2000),
 status:z.enum(['draft','published']),
 position:z.number().int().min(-1000).max(1000),
};
export const createDocumentInput=z.object({
 ...documentFields,
 effectiveLabel:documentFields.effectiveLabel.default(''),body:documentFields.body.default(''),closingNote:documentFields.closingNote.default(''),
 status:documentFields.status.default('draft'),position:documentFields.position.default(0)
}).strict();
export const updateDocumentInput=z.object(documentFields).partial().extend({version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
export const restoreDocumentInput=z.object({revision:z.number().int().positive(),version}).strict();
export const documentQueryInput=paginationInput.extend({status:z.enum(['draft','published']).optional()});
