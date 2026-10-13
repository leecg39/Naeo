import {z} from 'zod';
import type {Database} from '../database';
import {requireAdmin,type User} from '../auth';
import {body,json,rateLimit} from '../http';
import {createArticle,createCategory,deleteArticle,deleteCategory,getAdminArticle,listAdminArticles,listAdminCategories,previewMarkdown,restoreArticleRevision,updateArticle,updateCategory} from './admin-articles';

/** 기사 본문은 최대 20만 자(한글 UTF-8 약 600KB)라 기사 저장 요청만 1MB까지 받는다. */
const ARTICLE_BODY_MAX=1024*1024;
const anyJson=z.unknown();
const ID='([a-f0-9-]{36})';

export async function contentApi(db:Database,request:Request,user:User):Promise<Response|null>{
 const {pathname:path,searchParams}=new URL(request.url),method=request.method;
 if(!path.startsWith('/api/admin/articles')&&!path.startsWith('/api/admin/article-categories'))return null;
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
 return null;
}
