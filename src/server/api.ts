import { database, type Database } from './database';
import { register, login, logout, requireUser, requireAdmin, requireTerms, sessionUser } from './auth';
import {accountApi} from './account-api';
import {contentApi} from './content/content-api';
import {inquiryApi,publicInquiryApi} from './inquiries/inquiry-api';
import {scanApi} from './jobs/scan-api';
import {memberMateApi,publicMateApi} from './mate/mate-api';
import {keywordsApi} from './keywords/keywords-api';
import {competitorsApi} from './competitors/competitors-api';
import {acceptTerms} from './account-security';
import { getProfile, updateProfile } from './profiles';
import { listBlogs, getBlog, createBlog, updateBlog, deleteBlog } from './blogs';
import { registerInput, loginInput, profileInput, createBlogInput, updateBlogInput, deleteInput,acceptTermsInput } from './validation';
import { AppError } from './errors';
import { endpoint, requireOrigin, cookieToken, sessionCookie, body, json, authRateLimit } from './http';

// A factory permits integration tests to exercise the exact HTTP handlers against isolated databases.
export function createApi(getDatabase:()=>Database=database) {
  return endpoint(async request=>{
    const url=new URL(request.url),path=url.pathname,method=request.method;
    const db=getDatabase();
    if(!['GET','HEAD','OPTIONS'].includes(method)) requireOrigin(request);
    if(path==='/api/health'&&method==='GET') {
      const {version}=db.prepare('SELECT max(version) AS version FROM schema_migrations').get() as {version:number};
      return json({data:{status:'ok',schemaVersion:version}});
    }
    if((path==='/api/auth/register'||path==='/api/auth/login')&&method==='POST') {
      const result=path.endsWith('/register')?await (async()=>{
        const input=await body(request,registerInput);authRateLimit(db,request,input.email);return register(db,input);
      })():await (async()=>{
        const input=await body(request,loginInput);authRateLimit(db,request,input.email);return login(db,input);
      })();
      return json({data:{user:result.user,profile:getProfile(db,result.user.id)}},path.endsWith('/register')?201:200,{'Set-Cookie':sessionCookie(result.session.token)});
    }
    if(path==='/api/auth/logout'&&method==='POST') {
      logout(db,cookieToken(request));
      return json({data:{signedOut:true}},200,{'Set-Cookie':sessionCookie('',0)});
    }
    const publicInquiry=await publicInquiryApi(db,request);
    if(publicInquiry)return publicInquiry;
    const publicMate=await publicMateApi(db,request,sessionUser(db,cookieToken(request)));
    if(publicMate)return publicMate;
    const user=requireUser(db,cookieToken(request));
    if(path==='/api/auth/me'&&method==='GET') return json({data:{user,profile:getProfile(db,user.id)}});
    if(path==='/api/auth/terms'&&method==='POST')return json({data:acceptTerms(db,user.id,await body(request,acceptTermsInput))});
    // Withdrawal and session management remain available even before consent.
    if(!path.startsWith('/api/auth/'))requireTerms(user);
    const accountResponse=await accountApi(db,request,user);
    if(accountResponse)return accountResponse;
    const contentResponse=await contentApi(db,request,user);
    if(contentResponse)return contentResponse;
    const inquiryResponse=await inquiryApi(db,request,user);
    if(inquiryResponse)return inquiryResponse;
    const scanResponse=await scanApi(db,request,user);
    if(scanResponse)return scanResponse;
    const mateResponse=memberMateApi(db,request,user);
    if(mateResponse)return mateResponse;
    const keywordsResponse=await keywordsApi(db,request,user);
    if(keywordsResponse)return keywordsResponse;
    const competitorsResponse=await competitorsApi(db,request,user);
    if(competitorsResponse)return competitorsResponse;
    if(path==='/api/profile') {
      if(method==='GET') return json({data:getProfile(db,user.id)});
      if(method==='PATCH') return json({data:updateProfile(db,user.id,await body(request,profileInput))});
    }
    if(path==='/api/blogs') {
      if(method==='GET') return json(listBlogs(db,user.id,Object.fromEntries(url.searchParams)));
      if(method==='POST') return json({data:createBlog(db,user.id,await body(request,createBlogInput))},201);
    }
    const blogMatch=path.match(/^\/api\/blogs\/([a-f0-9-]{36})$/);
    if(blogMatch) {
      if(method==='GET') return json({data:getBlog(db,user.id,blogMatch[1])});
      if(method==='PATCH') return json({data:updateBlog(db,user.id,blogMatch[1],await body(request,updateBlogInput))});
      if(method==='DELETE') return json({data:deleteBlog(db,user.id,blogMatch[1],await body(request,deleteInput))});
    }
    if(path.startsWith('/api/admin/')) requireAdmin(user);
    throw new AppError(404,'NOT_FOUND','요청한 API를 찾을 수 없습니다.');
  });
}
