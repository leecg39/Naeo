import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer,type IncomingMessage} from 'node:http';
import type {AddressInfo} from 'node:net';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createApi} from '../../src/server/api';
import {startOAuth,completeOAuth,listConnections,unlinkProvider,setInitialPassword} from '../../src/server/oauth/oauth';

const origin='http://127.0.0.1:3000';
process.env.NAEO_APP_URL=origin;
const MIN=60_000;
type Code={sub:string;email:string|null;verified:boolean;nonce?:string;challenge?:string;name?:string};
const b64=(o:unknown)=>Buffer.from(JSON.stringify(o)).toString('base64url');
/** 구글(PKCE S256·nonce·클라이언트 시크릿)과 네이버(시크릿·state, PKCE 없음)를 흉내 내는 로컬 IdP. */
async function idpStub(t:TestContext){
 const codes=new Map<string,Code>(),tokens=new Map<string,Code>();
 const form=(req:IncomingMessage)=>new Promise<URLSearchParams>(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>r(new URLSearchParams(b)));});
 const server=createServer(async(req,res)=>{
  const send=(s:number,b:unknown)=>{res.writeHead(s,{'Content-Type':'application/json'});res.end(JSON.stringify(b));};
  const url=new URL(req.url!,'http://stub');
  if(url.pathname==='/google/token'&&req.method==='POST'){
   const f=await form(req),c=codes.get(f.get('code')??'');
   if(!c||f.get('client_id')!=='g-client'||f.get('client_secret')!=='g-secret-dummy'||f.get('redirect_uri')!==`${origin}/api/auth/oauth/google/callback`)return send(400,{error:'invalid_grant'});
   if(createHash('sha256').update(f.get('code_verifier')??'').digest('base64url')!==c.challenge)return send(400,{error:'invalid_grant',error_description:'PKCE'});
   codes.delete(f.get('code')!);
   return send(200,{access_token:'at',token_type:'Bearer',id_token:`${b64({alg:'none'})}.${b64({iss:'https://accounts.google.com',aud:'g-client',sub:c.sub,email:c.email,email_verified:c.verified,nonce:c.nonce,name:c.name,exp:Math.floor(Date.now()/1000)+600})}.sig`});
  }
  if(url.pathname==='/naver/token'){
   const c=codes.get(url.searchParams.get('code')??'');
   if(!c||url.searchParams.get('client_secret')!=='n-secret-dummy'||url.searchParams.get('grant_type')!=='authorization_code')return send(200,{error:'invalid_request'});
   codes.delete(url.searchParams.get('code')!);tokens.set('nt-'+c.sub,c);
   return send(200,{access_token:'nt-'+c.sub,token_type:'bearer'});
  }
  if(url.pathname==='/naver/me'){
   const c=tokens.get((req.headers.authorization??'').replace('Bearer ',''));
   if(!c)return send(401,{resultcode:'024',message:'Authentication failed'});
   return send(200,{resultcode:'00',message:'success',response:{id:c.sub,nickname:c.name??'네이버회원',...(c.email?{email:c.email}:{})}});
  }
  send(404,{});
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 return{base:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,codes};
}
function withEnv(t:TestContext,vars:Record<string,string|undefined>){
 const before=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));
 for(const [k,v] of Object.entries(vars)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 t.after(()=>{for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
}
async function fixture(t:TestContext){
 const idp=await idpStub(t);
 withEnv(t,{NAEO_GOOGLE_CLIENT_ID:'g-client',NAEO_GOOGLE_CLIENT_SECRET:'g-secret-dummy',NAEO_NAVER_CLIENT_ID:'n-client',NAEO_NAVER_CLIENT_SECRET:'n-secret-dummy',NAEO_OAUTH_ENDPOINT_BASE:idp.base});
 const db=openDatabase(':memory:');t.after(()=>db.close());
 return{db,idp};
}
/** 인가 화면을 대신해 코드를 발급한다(시작 주소의 state·nonce·challenge를 그대로 묶음). */
function authorize(idp:{codes:Map<string,Code>},url:string,code:string,who:Omit<Code,'nonce'|'challenge'>){
 const u=new URL(url);
 idp.codes.set(code,{...who,nonce:u.searchParams.get('nonce')??undefined,challenge:u.searchParams.get('code_challenge')??undefined});
 return u.searchParams.get('state')!;
}
const users=(db:Database)=>(db.prepare('SELECT count(*) AS n FROM users').get() as {n:number}).n;

test('not configured providers are refused before anything is stored',async t=>{
 withEnv(t,{NAEO_GOOGLE_CLIENT_ID:undefined,NAEO_GOOGLE_CLIENT_SECRET:undefined});
 const db=openDatabase(':memory:');t.after(()=>db.close());
 assert.throws(()=>startOAuth(db,'google',{intent:'login',next:'/x'}),{status:503,code:'OAUTH_NOT_CONFIGURED'});
 assert.equal((db.prepare('SELECT count(*) AS n FROM oauth_states').get() as {n:number}).n,0);
});

test('google: PKCE + nonce + browser-bound single-use state; new members must accept the terms',async t=>{
 const {db,idp}=await fixture(t);
 const start=startOAuth(db,'google',{intent:'login',next:'//evil.example/x'});
 const u=new URL(start.url);
 assert.equal(u.searchParams.get('code_challenge_method'),'S256');
 assert.equal(u.searchParams.get('redirect_uri'),`${origin}/api/auth/oauth/google/callback`);
 assert.ok((u.searchParams.get('code_verifier')??'')==='','the verifier never leaves the server');
 const state=authorize(idp,start.url,'c1',{sub:'g-1',email:'New@Example.test',verified:true,name:'새 회원'});
 await assert.rejects(completeOAuth(db,'google',{code:'c1',state},'wrong-binding'),{code:'OAUTH_STATE_INVALID'},'other browsers cannot finish the flow');
 const done=await completeOAuth(db,'google',{code:'c1',state},start.binding);
 assert.equal(done.kind,'login');assert.equal(done.next,'/dashboard','unsafe next falls back');
 assert.equal(done.needsTerms,true);
 const user=db.prepare('SELECT email,terms_accepted_at AS t,email_verified_at AS v FROM users WHERE id=?').get(done.userId) as {email:string;t:number;v:number|null};
 assert.deepEqual([user.email,user.t,user.v!==null],['new@example.test',0,true]);
 await assert.rejects(completeOAuth(db,'google',{code:'c1',state},start.binding),{code:'OAUTH_STATE_INVALID'},'state is single use');
 const again=startOAuth(db,'google',{intent:'login',next:'/ranking'});
 const s2=authorize(idp,again.url,'c2',{sub:'g-1',email:'new@example.test',verified:true});
 const back=await completeOAuth(db,'google',{code:'c2',state:s2},again.binding);
 assert.equal(back.userId,done.userId);assert.equal(back.next,'/ranking');assert.equal(users(db),1);
 const bad=startOAuth(db,'google',{intent:'login',next:'/'});
 const s3=authorize(idp,bad.url,'c3',{sub:'g-2',email:'x@example.test',verified:true});
 idp.codes.set('c3',{...idp.codes.get('c3')!,nonce:'replayed-nonce-from-elsewhere'});
 await assert.rejects(completeOAuth(db,'google',{code:'c3',state:s3},bad.binding),{code:'OAUTH_EXCHANGE_FAILED'},'nonce mismatch');
 const late=startOAuth(db,'google',{intent:'login',next:'/'},Date.now()-11*MIN);
 const s4=authorize(idp,late.url,'c4',{sub:'g-3',email:'y@example.test',verified:true});
 await assert.rejects(completeOAuth(db,'google',{code:'c4',state:s4},late.binding),{code:'OAUTH_STATE_INVALID'},'10-minute expiry');
 const deny=startOAuth(db,'google',{intent:'login',next:'/'});
 await assert.rejects(completeOAuth(db,'google',{error:'access_denied',state:new URL(deny.url).searchParams.get('state')},deny.binding),{code:'OAUTH_DENIED'});
});

test('no silent account takeover; linking, conflicts, unlinking and the last login method',async t=>{
 const {db,idp}=await fixture(t);
 const pw=(await register(db,{email:'owner@example.test',password:'owner-long-password',nickname:'주인',termsAccepted:true})).user.id;
 const login=startOAuth(db,'google',{intent:'login',next:'/'});
 const s1=authorize(idp,login.url,'c1',{sub:'g-owner',email:'owner@example.test',verified:true});
 await assert.rejects(completeOAuth(db,'google',{code:'c1',state:s1},login.binding),{code:'OAUTH_EMAIL_EXISTS'},'same email is not auto-linked');
 const link=startOAuth(db,'google',{intent:'link',userId:pw,next:'/dashboard/settings'});
 const s2=authorize(idp,link.url,'c2',{sub:'g-owner',email:'owner@example.test',verified:true});
 assert.equal((await completeOAuth(db,'google',{code:'c2',state:s2},link.binding)).kind,'linked');
 assert.deepEqual(listConnections(db,pw).map(c=>c.provider),['google']);
 const other=(await register(db,{email:'other@example.test',password:'other-long-password',nickname:'남',termsAccepted:true})).user.id;
 const steal=startOAuth(db,'google',{intent:'link',userId:other,next:'/'});
 const s3=authorize(idp,steal.url,'c3',{sub:'g-owner',email:'owner@example.test',verified:true});
 await assert.rejects(completeOAuth(db,'google',{code:'c3',state:s3},steal.binding),{code:'OAUTH_ALREADY_LINKED'});
 unlinkProvider(db,pw,'google');
 assert.equal(listConnections(db,pw).length,0);
 const n=startOAuth(db,'naver',{intent:'login',next:'/'});
 assert.equal(new URL(n.url).searchParams.get('code_challenge'),null,'naver has no PKCE');
 const s4=authorize(idp,n.url,'n1',{sub:'n-9',email:null,verified:false});
 await assert.rejects(completeOAuth(db,'naver',{code:'n1',state:s4},n.binding),{code:'OAUTH_EMAIL_REQUIRED'});
 const n2=startOAuth(db,'naver',{intent:'login',next:'/'});
 const s5=authorize(idp,n2.url,'n2',{sub:'n-10',email:'naver.user@example.test',verified:false,name:'네이버 회원'});
 const created=await completeOAuth(db,'naver',{code:'n2',state:s5},n2.binding);
 assert.throws(()=>unlinkProvider(db,created.userId,'naver'),{status:409,code:'LAST_LOGIN_METHOD'});
 assert.throws(()=>setInitialPassword(db,created.userId,Date.now()-11*MIN,{newPassword:'new-long-password'}),{status:403,code:'REAUTH_REQUIRED'});
 await setInitialPassword(db,created.userId,Date.now()-MIN,{newPassword:'new-long-password'});
 assert.throws(()=>setInitialPassword(db,created.userId,Date.now(),{newPassword:'another-long-pass'}),{status:409,code:'PASSWORD_ALREADY_SET'});
 unlinkProvider(db,created.userId,'naver');
 db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(other);
 const link2=startOAuth(db,'naver',{intent:'link',userId:other,next:'/'});
 const s6=authorize(idp,link2.url,'n3',{sub:'n-11',email:'o@example.test',verified:false});
 await assert.rejects(completeOAuth(db,'naver',{code:'n3',state:s6},link2.binding),{code:'ACCOUNT_SUSPENDED'});
});

test('HTTP: start sets a binding cookie, the callback signs in and redirects, errors go back to login',async t=>{
 const {db,idp}=await fixture(t);
 const handler=createApi(()=>db);
 const get=(p:string,cookie?:string)=>handler(new Request(origin+p,{headers:cookie?{Cookie:cookie}:{}}));
 const start=await get('/api/auth/oauth/google/start?next=%2Franking');
 assert.equal(start.status,302);
 const binding=start.headers.get('set-cookie')!.split(';')[0];
 assert.match(start.headers.get('set-cookie')!,/HttpOnly/);
 const state=authorize(idp,start.headers.get('location')!,'h1',{sub:'g-h',email:'h@example.test',verified:true});
 const noCookie=await get(`/api/auth/oauth/google/callback?code=h1&state=${state}`);
 assert.equal(noCookie.headers.get('location'),'/login?oauthError=OAUTH_STATE_INVALID');
 const start2=await get('/api/auth/oauth/google/start?next=%2Franking');
 const binding2=start2.headers.get('set-cookie')!.split(';')[0];
 const state2=authorize(idp,start2.headers.get('location')!,'h2',{sub:'g-h',email:'h@example.test',verified:true});
 const cb=await get(`/api/auth/oauth/google/callback?code=h2&state=${state2}`,binding2);
 assert.equal(cb.status,302);
 assert.equal(cb.headers.get('location'),'/auth/terms?next=%2Franking');
 assert.match(cb.headers.getSetCookie().join(';'),/naeo_session=/);
 assert.equal((await get('/api/auth/oauth/kakao/start')).status,404);
 assert.ok(binding.startsWith('naeo_oauth='));
});
