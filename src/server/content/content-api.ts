import {z} from 'zod';
import type {Database} from '../database';
import {requireAdmin,type User} from '../auth';
import {body,json,rateLimit} from '../http';
import {createArticle,createCategory,deleteArticle,deleteCategory,getAdminArticle,listAdminArticles,listAdminCategories,previewMarkdown,restoreArticleRevision,updateArticle,updateCategory} from './admin-articles';
import {createFaq,deleteFaq,listAdminFaq,updateFaq} from './admin-faq';
import {createDocument,deleteDocument,getAdminDocument,listAdminDocuments,restoreDocumentRevision,updateDocument} from './admin-documents';

/** 기사 본문은 최대 20만 자(한글 UTF-8 약 600KB)라 기사 저장 요청만 1MB까지 받는다. */
const ARTICLE_BODY_MAX=1024*1024;
const anyJson=z.unknown();
const ID='([a-f0-9-]{36})';

export async function contentApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path,searchParams}=new URL(request.url),method=request.method;
 if(!['/api/admin/articles','/api/admin/article-categories','/api/admin/documents','/api/admin/faq'].some(p=>path===p||path.startsWith(p+'/')))return null;
 requireAdmin(user);
 if(method!=='GET')rateLimit(db,`content:${user.id}`,300,15*60*1000);
 const input=(max?:number)=>body(request,anyJson,max);

 if(path==='/api/admin/articles'){
  if(method==='GET')return json(listAdminArticles(db,user.id,Object.fromEntries(searchParams)));
  if(method==='POST')return json({data:createArticle(db,user.id,await input(ARTICLE_BODY_MAX))},201);
 }
 if(path==='/api/admin/articles/preview'&&method==='POST')return json({data:previewMarkdown(await input(ARTICLE_BODY_MAX))});
 const restore=path.match(new RegExp(`^/api/admin/articles/${ID}/restore$`));
 if(restore&&method==='POST')return json({data:restoreArticleRevision(db,user.id,restore[1],await input())});
 const article=path.match(new RegExp(`^/api/admin/articles/${ID}$`));
 if(article){
  if(method==='GET')return json({data:getAdminArticle(db,user.id,article[1])});
  if(method==='PATCH')return json({data:updateArticle(db,user.id,article[1],await input(ARTICLE_BODY_MAX))});
  if(method==='DELETE')return json({data:deleteArticle(db,user.id,article[1],await input())});
 }
 if(path==='/api/admin/article-categories'){
  if(method==='GET')return json({data:listAdminCategories(db,user.id)});
  if(method==='POST')return json({data:createCategory(db,user.id,await input())},201);
 }
 const category=path.match(new RegExp(`^/api/admin/article-categories/${ID}$`));
 if(category){
  if(method==='PATCH')return json({data:updateCategory(db,user.id,category[1],await input())});
  if(method==='DELETE')return json({data:deleteCategory(db,user.id,category[1],await input())});
 }
 return (await faqRoutes(db,user,path,method,searchParams,input))??documentRoutes(db,user,path,method,searchParams,input);
}

/** FAQ 관리자 CRUD. */
async function faqRoutes(db:Database,user:User,path:string,method:string,searchParams:URLSearchParams,input:(max?:number)=>Promise<unknown>):Promise<Response|null>{
 if(path==='/api/admin/faq'){
  if(method==='GET')return json(listAdminFaq(db,user.id,Object.fromEntries(searchParams)));
  if(method==='POST')return json({data:createFaq(db,user.id,await input())},201);
 }
 const item=path.match(new RegExp(`^/api/admin/faq/${ID}$`));
 if(item){
  if(method==='PATCH')return json({data:updateFaq(db,user.id,item[1],await input())});
  if(method==='DELETE')return json({data:deleteFaq(db,user.id,item[1],await input())});
 }
 return null;
}

/** 정책 문서(약관·개인정보·환불 등) 관리자 CRUD. 본문은 최대 10만 자라 1MB까지 받는다. */
async function documentRoutes(db:Database,user:User,path:string,method:string,searchParams:URLSearchParams,input:(max?:number)=>Promise<unknown>):Promise<Response|null>{
 if(path==='/api/admin/documents'){
  if(method==='GET')return json(listAdminDocuments(db,user.id,Object.fromEntries(searchParams)));
  if(method==='POST')return json({data:createDocument(db,user.id,await input(ARTICLE_BODY_MAX))},201);
 }
 const restore=path.match(new RegExp(`^/api/admin/documents/${ID}/restore$`));
 if(restore&&method==='POST')return json({data:restoreDocumentRevision(db,user.id,restore[1],await input())});
 const doc=path.match(new RegExp(`^/api/admin/documents/${ID}$`));
 if(doc){
  if(method==='GET')return json({data:getAdminDocument(db,user.id,doc[1])});
  if(method==='PATCH')return json({data:updateDocument(db,user.id,doc[1],await input(ARTICLE_BODY_MAX))});
  if(method==='DELETE')return json({data:deleteDocument(db,user.id,doc[1],await input())});
 }
 return null;
}
