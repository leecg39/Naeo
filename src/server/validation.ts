import { z } from 'zod';

export const email = z.string().trim().toLowerCase().email().max(254);
export const password = z.string().min(10, '비밀번호는 10자 이상 입력해주세요.').max(128);
export const nickname = z.string().trim().min(1).max(30);
export const version = z.number().int().positive();
export const registerInput = z.object({ email, password, nickname, termsAccepted: z.literal(true) }).strict();
export const loginInput = z.object({ email, password: z.string().min(1).max(128) }).strict();
export const profileInput = z.object({
  nickname: nickname.optional(),
  avatarUrl: z.union([z.literal(''),z.string().url().max(2048).refine(v=>new URL(v).protocol==='https:', 'HTTPS 주소만 사용할 수 있습니다.')]).optional(),
  rankingPublic: z.boolean().optional(),
  version,
}).strict().refine(v=>Object.keys(v).length>1, '수정할 항목이 필요합니다.');
export const blogFields = {
  naverId: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,49}$/, '올바른 네이버 블로그 ID를 입력해주세요.'),
  title: z.string().trim().min(1).max(120),
  category: z.string().trim().max(50),
  isPrimary: z.boolean(),
};
export const createBlogInput = z.object({naverId:blogFields.naverId,title:blogFields.title,category:blogFields.category.default(''),isPrimary:blogFields.isPrimary.default(false)}).strict();
export const updateBlogInput = z.object(blogFields).partial().extend({version}).strict().refine(v=>Object.keys(v).length>1, '수정할 항목이 필요합니다.');
export const deleteInput = z.object({version}).strict();
export const paginationInput = z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20),q:z.string().trim().max(100).default('')});
export const reauthenticateInput=z.object({currentPassword:z.string().min(1).max(128)}).strict();
export const changePasswordInput=reauthenticateInput.extend({newPassword:password}).strict();
export const deleteAccountInput=reauthenticateInput.extend({confirmEmail:email,version}).strict();
export const acceptTermsInput=z.object({termsAccepted:z.literal(true)}).strict();
export const createUserInput=z.object({email,nickname,password,role:z.enum(['member','admin']).default('member'),currentPassword:z.string().min(1).max(128)}).strict();
export const updateUserInput=z.object({role:z.enum(['member','admin']).optional(),status:z.enum(['active','suspended']).optional(),nickname:nickname.optional(),version,currentPassword:z.string().min(1).max(128)}).strict().refine(v=>v.role!==undefined||v.status!==undefined||v.nickname!==undefined,'수정할 항목이 필요합니다.');
export const deleteUserInput=reauthenticateInput.extend({confirmEmail:email,version}).strict();
export const userQueryInput=paginationInput.extend({role:z.enum(['member','admin']).optional(),status:z.enum(['active','suspended']).optional()});
export const contactFields={name:z.string().trim().min(1).max(80),email,phone:z.union([z.literal(''),z.string().regex(/^\+?[0-9]{8,15}$/,'숫자만 입력하거나 국제번호 앞에 +를 붙여주세요.')])};
export const createContactInput=z.object(contactFields).strict();
export const updateContactInput=z.object(contactFields).extend({version}).strict();
export const preferencesInput=z.object({marketingEmail:z.boolean().optional(),scanEmail:z.boolean().optional(),autoscan:z.boolean().optional(),version}).strict().refine(v=>Object.keys(v).length>1,'수정할 항목이 필요합니다.');
