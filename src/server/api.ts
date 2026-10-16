import {smsApi} from './sms/api';
import {announcementApi} from './content/announcement-api';
import {publicMailApi,memberMailApi} from './mail/api';
import { database, type Database } from './database';
import { register, login, logout, requireUser, requireAdmin, requireTerms, sessionUser } from './auth';
import {accountApi} from './account-api';
import {contentApi} from './content/content-api';
import {inquiryApi,publicInquiryApi} from './inquiries/inquiry-api';
import {scanApi} from './jobs/scan-api';
import {memberMateApi,publicMateApi} from './mate/mate-api';
import {keywordsApi} from './keywords/keywords-api';
import {competitorsApi} from './competitors/competitors-api';
import {publicShareApi,writingApi} from './writing/writing-api';
import {generationApi} from './generation/generation-api';
import {memberRankingApi,publicRankingApi} from './ranking/ranking-api';
import {adminEventsApi,memberEventsApi,publicEventsApi} from './events/events-api';
import {adminBillingApi,memberBillingApi,publicBillingApi,WEBHOOK_PATH} from './billing/billing-api';
import {memberOAuthApi,publicOAuthApi} from './oauth/oauth-api';
import {memberAuthzApi,publicAuthzApi,SERVER_TO_SERVER} from './oauth/authz-api';
import {mcpApi} from './mcp/mcp-api';
import {creativeApi} from './creative/creative-api';
import {adminOpsApi,publicAnalyticsApi} from './ops/analytics-api';
import {engagementApi} from './engagement/api';
import {memberOpenAIApi,publicOpenAIApi} from './openai/api';
import {citationApi} from './citations/api';
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
    // 결제사 웹훅은 서버 간 호출이라 Origin이 없다(본문을 믿지 않고 결제사에 다시 조회한다).
    if(!['GET','HEAD','OPTIONS'].includes(method)&&path!==WEBHOOK_PATH&&!SERVER_TO_SERVER.includes(path)) requireOrigin(request);
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
    const publicMail=await publicMailApi(db,request);if(publicMail)return publicMail;
    const announcements=announcementApi(db,request);if(announcements)return announcements;
    const analytics=await publicAnalyticsApi(db,request);
    if(analytics)return analytics;
    const mcp=await mcpApi(db,request);
    if(mcp)return mcp;
    const publicAuthz=await publicAuthzApi(db,request);
    if(publicAuthz)return publicAuthz;
    const publicOAuth=await publicOAuthApi(db,request);
    if(publicOAuth)return publicOAuth;
    const publicOpenAI=await publicOpenAIApi(db,request);
    if(publicOpenAI)return publicOpenAI;
    const publicInquiry=await publicInquiryApi(db,request);
    if(publicInquiry)return publicInquiry;
    const publicMate=await publicMateApi(db,request,sessionUser(db,cookieToken(request)));
    if(publicMate)return publicMate;
    const publicShare=publicShareApi(db,request);
    if(publicShare)return publicShare;
    const publicRanking=publicRankingApi(db,request,sessionUser(db,cookieToken(request)));
    if(publicRanking)return publicRanking;
    const publicEvents=publicEventsApi(db,request);
    if(publicEvents)return publicEvents;
    const publicBilling=await publicBillingApi(db,request);
    if(publicBilling)return publicBilling;
    const user=requireUser(db,cookieToken(request));
    if(path==='/api/auth/me'&&method==='GET') return json({data:{user,profile:getProfile(db,user.id)}});
    if(path==='/api/auth/terms'&&method==='POST')return json({data:acceptTerms(db,user.id,await body(request,acceptTermsInput))});
    // Withdrawal and session management remain available even before consent.
    if(!path.startsWith('/api/auth/'))requireTerms(user);
    const sms=await smsApi(db,request,user);if(sms)return sms;
    const memberMail=await memberMailApi(db,request,user);if(memberMail)return memberMail;
    const engagementResponse=await engagementApi(db,request,user);
    if(engagementResponse)return engagementResponse;
    const authzResponse=await memberAuthzApi(db,request,user);
    if(authzResponse)return authzResponse;
    const oauthResponse=await memberOAuthApi(db,request,user);
    if(oauthResponse)return oauthResponse;
    const openAIResponse=await memberOpenAIApi(db,request,user);
    if(openAIResponse)return openAIResponse;
    const accountResponse=await accountApi(db,request,user);
    if(accountResponse)return accountResponse;
    const contentResponse=await contentApi(db,request,user);
    if(contentResponse)return contentResponse;
    const inquiryResponse=await inquiryApi(db,request,user);
    if(inquiryResponse)return inquiryResponse;
    const scanResponse=await scanApi(db,request,user);
    if(scanResponse)return scanResponse;
    const citationResponse=await citationApi(db,request,user);
    if(citationResponse)return citationResponse;
    const mateResponse=memberMateApi(db,request,user);
    if(mateResponse)return mateResponse;
    const keywordsResponse=await keywordsApi(db,request,user);
    if(keywordsResponse)return keywordsResponse;
    const competitorsResponse=await competitorsApi(db,request,user);
    if(competitorsResponse)return competitorsResponse;
    const writingResponse=await writingApi(db,request,user);
    if(writingResponse)return writingResponse;
    const generationResponse=await generationApi(db,request,user);
    if(generationResponse)return generationResponse;
    const rankingResponse=await memberRankingApi(db,request,user);
    if(rankingResponse)return rankingResponse;
    const eventsResponse=await memberEventsApi(db,request,user)??await adminEventsApi(db,request,user);
    if(eventsResponse)return eventsResponse;
    const opsResponse=adminOpsApi(db,request,user);
    if(opsResponse)return opsResponse;
    const creativeResponse=await creativeApi(db,request,user);
    if(creativeResponse)return creativeResponse;
    const billingResponse=await memberBillingApi(db,request,user)??await adminBillingApi(db,request,user);
    if(billingResponse)return billingResponse;
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
