import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign as signBytes} from 'node:crypto';
import {createServer,type IncomingMessage} from 'node:http';
import type {AddressInfo} from 'node:net';
import {openDatabase,type Database} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createApi} from '../../src/server/api';
import {openAIConnectionConfig,type OpenAIConnectionConfig} from '../../src/server/openai/config';
import {completeOpenAIConnection,disconnectOpenAI,openAIConnection,startOpenAIConnection} from '../../src/server/openai/connection';
import {openAIAccessToken} from '../../src/server/openai/credentials';
import type {FetchLike} from '../../src/server/openai/oauth-provider';
import {datasets,exclusions} from '../../src/server/privacy/datasets';
import {grantCredits,balance} from '../../src/server/credits/ledger';
import {getGeneration,requestGeneration,GENERATION_COST} from '../../src/server/generation/generation';
import {runGenerationOnce} from '../../src/server/generation/worker';
import {runtimeGenerationProvider} from '../../src/server/generation/runtime-provider';
import {openAIOAuthProvider} from '../../src/server/generation/provider';

const origin='http://127.0.0.1:3000',now=1_800_000_000_000;
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
const b64=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt(input:{issuer:string;clientId:string;nonce:string;subject?:string;email?:string;issuedAt?:number},key=privateKey){
 const issuedAt=input.issuedAt??now,head=b64({alg:'RS256',kid:'test-key'}),body=b64({iss:input.issuer,aud:input.clientId,sub:input.subject??'openai-subject-1',email:input.email??'member@example.test',email_verified:true,name:'ChatGPT 회원',nonce:input.nonce,iat:Math.floor(issuedAt/1000),exp:Math.floor(issuedAt/1000)+600});
 return `${head}.${body}.${signBytes('RSA-SHA256',Buffer.from(`${head}.${body}`),key).toString('base64url')}`;
}
function config(base='http://127.0.0.1:3196'):OpenAIConnectionConfig{return{
 clientId:'oaiapp_test_client',clientSecret:'',tokenAuthMethod:'none',encryptionKey:Buffer.from('42'.repeat(32),'hex'),issuer:base,
 authorizeEndpoint:`${base}/authorize`,tokenEndpoint:`${base}/token`,jwksEndpoint:`${base}/jwks.json`,revocationEndpoint:`${base}/revoke`,
 apiBase:`${base}/v1`,
 redirectUri:`${origin}/api/account/openai/callback`,resource:'https://api.openai.com/v1',scopes:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
};}
function fixture(t:TestContext){const db=openDatabase(':memory:');t.after(()=>db.close());return db;}
async function member(db:Database,email='member@example.test'){return register(db,{email,password:'openai-test-password',nickname:'회원',termsAccepted:true});}
function provider(cfg:OpenAIConnectionConfig,nonce:string,options:{subject?:string;scope?:string;badSignature?:boolean;revoke?:boolean}={}):FetchLike{
 return async(url,init)=>{
  if(url===cfg.tokenEndpoint){
   const form=init?.body as URLSearchParams;
   assert.equal(form.get('grant_type'),'authorization_code');assert.equal(form.get('client_id'),cfg.clientId);assert.equal(form.get('resource'),cfg.resource);
   return Response.json({access_token:'access-token-secret',refresh_token:'refresh-token-secret',id_token:jwt({issuer:cfg.issuer,clientId:cfg.clientId,nonce,subject:options.subject},options.badSignature?generateKeyPairSync('rsa',{modulusLength:2048}).privateKey:privateKey),token_type:'Bearer',expires_in:3600,scope:options.scope??'openid offline_access resource.invoke chatgpt.tokens.use.direct',earliest_refresh_at:120});
  }
  if(url===cfg.jwksEndpoint)return Response.json({keys:[jwk]});
  if(url===cfg.revocationEndpoint)return new Response(null,{status:options.revoke===false?503:200});
  return new Response(null,{status:404});
 };
}

test('미설정이면 상태를 저장하지 않고 승인된 설정만 활성화한다',async t=>{
 const db=fixture(t),before={...process.env};
 t.after(()=>{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];for(const [key,value] of Object.entries(before))process.env[key]=value;});
 for(const key of ['NAEO_OPENAI_CLIENT_ID','NAEO_OPENAI_TOKEN_ENCRYPTION_KEY','NAEO_OPENAI_CLIENT_SECRET','NAEO_OPENAI_OAUTH_BASE'])delete process.env[key];
 assert.equal(openAIConnectionConfig(),null);
 assert.throws(()=>startOpenAIConnection(db,'missing-user'),{code:'OPENAI_NOT_CONFIGURED'});
 assert.equal((db.prepare('SELECT count(*) AS n FROM openai_connection_states').get() as {n:number}).n,0);
 assert.equal(openAIConnectionConfig({...process.env,NAEO_OPENAI_CLIENT_ID:'not-approved',NAEO_OPENAI_TOKEN_ENCRYPTION_KEY:'42'.repeat(32)}),null);
});

test('PKCE·nonce·브라우저 바인딩·일회 state를 확인하고 토큰은 암호문만 저장한다',async t=>{
 const db=fixture(t),account=await member(db),cfg=config(),started=startOpenAIConnection(db,account.user.id,cfg,now),url=new URL(started.url);
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('resource'),cfg.resource);assert.equal(url.searchParams.get('redirect_uri'),cfg.redirectUri);
 assert.ok(url.searchParams.get('scope')!.includes('chatgpt.tokens.use.direct'));assert.equal(url.searchParams.get('code_verifier'),null);
 const state=url.searchParams.get('state')!,nonce=url.searchParams.get('nonce')!;
 assert.equal((db.prepare('SELECT count(*) AS n FROM openai_connection_states WHERE state_hash=?').get(createHash('sha256').update(state).digest('hex')) as {n:number}).n,1,'state 원문은 저장하지 않는다');
 await assert.rejects(completeOpenAIConnection(db,account.user.id,{code:'code-1',state},'wrong',cfg,now,provider(cfg,nonce)),{code:'OPENAI_STATE_INVALID'});
 const result=await completeOpenAIConnection(db,account.user.id,{code:'code-1',state},started.binding,cfg,now,provider(cfg,nonce));
 assert.equal(result.connected,true);if(result.connected)assert.deepEqual([result.email,result.name],['member@example.test','ChatGPT 회원']);
 const row=db.prepare('SELECT * FROM openai_connections WHERE user_id=?').get(account.user.id) as Record<string,unknown>;
 for(const name of ['access_token_encrypted','refresh_token_encrypted','id_token_encrypted'])assert.match(String(row[name]),/^v1\./);
 const serialized=JSON.stringify({...row,view:openAIConnection(db,account.user.id)});
 for(const secret of ['access-token-secret','refresh-token-secret',url.searchParams.get('code_challenge')!])assert.ok(!serialized.includes(secret));
 await assert.rejects(completeOpenAIConnection(db,account.user.id,{code:'code-1',state},started.binding,cfg,now,provider(cfg,nonce)),{code:'OPENAI_STATE_INVALID'});
 const exported=datasets.find(item=>item.name==='openai_connection')!;
 const safe=JSON.stringify(db.prepare(exported.sql).all(account.user.id));
 assert.ok(!safe.includes('token_encrypted')&&!safe.includes('access-token-secret'));
 assert.ok(exclusions.some(value=>value.includes('encrypted OpenAI')));
});

test('권한·서명·계정 소유권 충돌을 거절한다',async t=>{
 const db=fixture(t),first=await member(db,'first@example.test'),second=await member(db,'second@example.test'),cfg=config();
 const missing=startOpenAIConnection(db,first.user.id,cfg,now),missingUrl=new URL(missing.url);
 await assert.rejects(completeOpenAIConnection(db,first.user.id,{code:'no-scope',state:missingUrl.searchParams.get('state')},missing.binding,cfg,now,provider(cfg,missingUrl.searchParams.get('nonce')!,{scope:'openid offline_access'})),{code:'OPENAI_USAGE_SCOPE_REQUIRED'});
 const bad=startOpenAIConnection(db,first.user.id,cfg,now),badUrl=new URL(bad.url);
 await assert.rejects(completeOpenAIConnection(db,first.user.id,{code:'bad-signature',state:badUrl.searchParams.get('state')},bad.binding,cfg,now,provider(cfg,badUrl.searchParams.get('nonce')!,{badSignature:true})),{code:'OPENAI_ID_TOKEN_INVALID'});
 const good=startOpenAIConnection(db,first.user.id,cfg,now),goodUrl=new URL(good.url);
 await completeOpenAIConnection(db,first.user.id,{code:'good',state:goodUrl.searchParams.get('state')},good.binding,cfg,now,provider(cfg,goodUrl.searchParams.get('nonce')!,{subject:'shared'}));
 const steal=startOpenAIConnection(db,second.user.id,cfg,now),stealUrl=new URL(steal.url);
 await assert.rejects(completeOpenAIConnection(db,second.user.id,{code:'steal',state:stealUrl.searchParams.get('state')},steal.binding,cfg,now,provider(cfg,stealUrl.searchParams.get('nonce')!,{subject:'shared'})),{code:'OPENAI_ALREADY_LINKED'});
 const switchAccount=startOpenAIConnection(db,first.user.id,cfg,now),switchUrl=new URL(switchAccount.url);
 await assert.rejects(completeOpenAIConnection(db,first.user.id,{code:'switch',state:switchUrl.searchParams.get('state')},switchAccount.binding,cfg,now,provider(cfg,switchUrl.searchParams.get('nonce')!,{subject:'different'})),{code:'OPENAI_ACCOUNT_MISMATCH'});
 assert.equal((db.prepare('SELECT count(*) AS n FROM openai_connections').get() as {n:number}).n,1);
});

test('원격 취소 실패나 암호문 손상에도 로컬 연결은 항상 삭제한다',async t=>{
 const db=fixture(t),account=await member(db),cfg=config(),connect=async()=>{const started=startOpenAIConnection(db,account.user.id,cfg,now),u=new URL(started.url);await completeOpenAIConnection(db,account.user.id,{code:'connect',state:u.searchParams.get('state')},started.binding,cfg,now,provider(cfg,u.searchParams.get('nonce')!));};
 await connect();assert.deepEqual(await disconnectOpenAI(db,account.user.id,cfg,provider(cfg,'unused',{revoke:false})),{disconnected:true,remoteRevocationConfirmed:false});
 assert.equal(openAIConnection(db,account.user.id).connected,false);
 await connect();db.prepare("UPDATE openai_connections SET refresh_token_encrypted='v1.broken.broken.broken' WHERE user_id=?").run(account.user.id);
 assert.deepEqual(await disconnectOpenAI(db,account.user.id,cfg,provider(cfg,'unused')),{disconnected:true,remoteRevocationConfirmed:false});
 assert.equal(openAIConnection(db,account.user.id).connected,false);
});

test('만료 access token은 한 lease에서 회전하고 terminal refresh 오류는 연결을 제거한다',async t=>{
 const db=fixture(t),account=await member(db),cfg=config(),started=startOpenAIConnection(db,account.user.id,cfg,now),url=new URL(started.url);
 await completeOpenAIConnection(db,account.user.id,{code:'initial',state:url.searchParams.get('state')},started.binding,cfg,now,provider(cfg,url.searchParams.get('nonce')!));
 db.prepare('UPDATE openai_connections SET access_expires_at=?,earliest_refresh_at=NULL WHERE user_id=?').run(now-1,account.user.id);
 let refreshCalls=0;
 const refreshFetch:FetchLike=async(endpoint,init)=>{
  assert.equal(endpoint,cfg.tokenEndpoint);const form=init?.body as URLSearchParams;assert.equal(form.get('grant_type'),'refresh_token');assert.equal(form.get('refresh_token'),'refresh-token-secret');assert.equal(form.get('resource'),cfg.resource);refreshCalls++;
  return Response.json({access_token:'rotated-access-token',refresh_token:'rotated-refresh-token',token_type:'Bearer',expires_in:3600,scope:'openid offline_access resource.invoke chatgpt.tokens.use.direct'});
 };
 assert.equal(await openAIAccessToken(db,account.user.id,1,cfg,refreshFetch,now),'rotated-access-token');assert.equal(refreshCalls,1);
 const rotated=db.prepare('SELECT token_version AS version,refresh_lease AS lease,last_refreshed_at AS refreshed FROM openai_connections WHERE user_id=?').get(account.user.id) as {version:number;lease:string|null;refreshed:number};
 assert.deepEqual({...rotated},{version:2,lease:null,refreshed:now});
 db.prepare('UPDATE openai_connections SET access_expires_at=?,earliest_refresh_at=NULL WHERE user_id=?').run(now-1,account.user.id);
 await assert.rejects(openAIAccessToken(db,account.user.id,1,cfg,async()=>Response.json({error:'invalid_grant'},{status:400}),now),{code:'OPENAI_REAUTH_REQUIRED'});
 assert.equal(openAIConnection(db,account.user.id).connected,false,'사용할 수 없는 회전 세션은 지운다');
});

test('OpenAI Responses는 계정 모델과 동일 bearer를 사용하고 completed 없는 스트림은 실패한다',async()=>{
 const calls:{url:string;authorization:string;body?:Record<string,unknown>}[]=[];
 const fetchOk:FetchLike=async(url,init)=>{
  const authorization=new Headers(init?.headers).get('authorization')??'',body=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:undefined;calls.push({url,authorization,body});
  if(url.endsWith('/models'))return Response.json({models:[{slug:'gpt-test-visible',display_name:'GPT Test',visibility:'list'},{slug:'hidden',visibility:'hide'}]});
  return new Response(['data: '+JSON.stringify({type:'response.output_text.delta',delta:'# OAuth 글\n\n## 본문\n\n완성'}),'data: '+JSON.stringify({type:'response.completed',response:{id:'r1'}}),''].join('\n\n'),{headers:{'Content-Type':'text/event-stream'}});
 };
 const output=await openAIOAuthProvider({apiBase:'http://127.0.0.1:3196/v1',accessToken:async()=>'member-bearer-token'},fetchOk)({keyword:'OAuth',category:'기술',title:'',experience:'',instructions:''});
 assert.deepEqual(output,{title:'OAuth 글',body:'## 본문\n\n완성'});assert.equal(calls.length,2);assert.ok(calls.every(call=>call.authorization==='Bearer member-bearer-token'));
 const request=calls[1].body!;assert.equal(request.model,'gpt-test-visible');assert.equal(request.store,false);assert.equal(request.stream,true);assert.equal(JSON.stringify(request).includes('max_tokens'),false);
 await assert.rejects(openAIOAuthProvider({apiBase:'http://127.0.0.1:3196/v1',accessToken:async()=>'member-bearer-token'},async url=>url.endsWith('/models')?Response.json({models:[{slug:'gpt-test',visibility:'list'}]}):new Response(`data: ${JSON.stringify({type:'response.output_text.delta',delta:'일부'})}\n\n`))({keyword:'중단',category:'',title:'',experience:'',instructions:''}),{code:'OPENAI_STREAM_INTERRUPTED',retryable:true});
});

test('생성 작업은 요청 회원의 연결 revision만 사용하고 해제된 대기 작업은 실패·환급한다',async t=>{
 const base='http://127.0.0.1:3195',keys=['NAEO_APP_URL','NAEO_OPENAI_CLIENT_ID','NAEO_OPENAI_TOKEN_ENCRYPTION_KEY','NAEO_OPENAI_TOKEN_AUTH_METHOD','NAEO_OPENAI_OAUTH_BASE','NAEO_OPENAI_API_BASE','ANTHROPIC_API_KEY'] as const,before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{NAEO_APP_URL:origin,NAEO_OPENAI_CLIENT_ID:'oaiapp_runtime_test',NAEO_OPENAI_TOKEN_ENCRYPTION_KEY:'42'.repeat(32),NAEO_OPENAI_TOKEN_AUTH_METHOD:'none',NAEO_OPENAI_OAUTH_BASE:base,NAEO_OPENAI_API_BASE:`${base}/v1`,ANTHROPIC_API_KEY:''});
 t.after(()=>{for(const key of keys){const value=before[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 const db=fixture(t),admin=await member(db,'runtime-admin@example.test'),a=await member(db,'runtime-a@example.test'),b=await member(db,'runtime-b@example.test');db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.user.id);
 const cfg=openAIConnectionConfig()!;
 const connect=async(userId:string,subject:string,access:string)=>{const started=startOpenAIConnection(db,userId,cfg,now),u=new URL(started.url);await completeOpenAIConnection(db,userId,{code:access,state:u.searchParams.get('state')},started.binding,cfg,now,async(endpoint)=>endpoint===cfg.tokenEndpoint?Response.json({access_token:access,refresh_token:`refresh-${access}`,id_token:jwt({issuer:cfg.issuer,clientId:cfg.clientId,nonce:u.searchParams.get('nonce')!,subject}),token_type:'Bearer',expires_in:3600,scope:'openid offline_access resource.invoke chatgpt.tokens.use.direct'}):Response.json({keys:[jwk]}));};
 await connect(a.user.id,'runtime-a','access-token-member-a');await connect(b.user.id,'runtime-b','access-token-member-b');
 grantCredits(db,admin.user.id,a.user.id,{delta:GENERATION_COST*2,note:'runtime'});grantCredits(db,admin.user.id,b.user.id,{delta:GENERATION_COST,note:'runtime'});
 const jobA=requestGeneration(db,a.user.id,{keyword:'회원 A',idempotencyKey:'oa-a'},undefined,now),jobB=requestGeneration(db,b.user.id,{keyword:'회원 B',idempotencyKey:'oa-b'},undefined,now);
 const stored=(db.prepare('SELECT provider,credential_revision AS revision FROM generation_jobs ORDER BY rowid').all() as {provider:string;revision:number}[]).map(value=>({...value}));assert.deepEqual(stored,[{provider:'openai_oauth',revision:1},{provider:'openai_oauth',revision:1}]);
 const used:{token:string;keyword:string}[]=[];
 const inference:FetchLike=async(url,init)=>{
  const token=(new Headers(init?.headers).get('authorization')??'').replace('Bearer ', '');
  if(url.endsWith('/models'))return Response.json({models:[{slug:'gpt-runtime',visibility:'list'}]});
  const body=JSON.parse(String(init?.body)) as {input:{content:string}[]},keyword=body.input.at(-1)!.content.includes('회원 A')?'회원 A':'회원 B';used.push({token,keyword});
  return new Response(`data: ${JSON.stringify({type:'response.output_text.delta',delta:`# ${keyword} 글\n\n## 본문\n\n저장됨`})}\n\ndata: ${JSON.stringify({type:'response.completed'})}\n\n`);
 };
 const runtime=runtimeGenerationProvider(db,inference);await runGenerationOnce(db,'runtime-worker',runtime,()=>now);await runGenerationOnce(db,'runtime-worker',runtime,()=>now);
 assert.deepEqual(used,[{token:'access-token-member-a',keyword:'회원 A'},{token:'access-token-member-b',keyword:'회원 B'}]);assert.equal(getGeneration(db,a.user.id,jobA.id).state,'succeeded');assert.equal(getGeneration(db,b.user.id,jobB.id).state,'succeeded');
 const queued=requestGeneration(db,a.user.id,{keyword:'해제 뒤 실패',idempotencyKey:'oa-a-disconnect'},undefined,now);assert.equal(balance(db,a.user.id),0);
 await disconnectOpenAI(db,a.user.id,cfg,async()=>new Response(null,{status:200}));await runGenerationOnce(db,'runtime-worker',runtime,()=>now);
 const failed=getGeneration(db,a.user.id,queued.id);assert.equal(failed.state,'failed');assert.equal(failed.errorCode,'OPENAI_CONNECTION_REQUIRED');assert.equal(balance(db,a.user.id),GENERATION_COST,'대기 작업 비용은 환급한다');
});

function readForm(req:IncomingMessage){return new Promise<URLSearchParams>(resolve=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>resolve(new URLSearchParams(body)));});}
async function oauthServer(t:TestContext){
 const pending=new Map<string,{nonce:string;challenge:string}>();let issuer='';
 const server=createServer(async(req,res)=>{
  const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  const path=new URL(req.url!,'http://stub').pathname;
  if(path==='/token'){
   const form=await readForm(req),entry=pending.get(form.get('code')??'');
   if(!entry||createHash('sha256').update(form.get('code_verifier')??'').digest('base64url')!==entry.challenge)return send(400,{error:'invalid_grant'});
   return send(200,{access_token:'http-access-secret',refresh_token:'http-refresh-secret',id_token:jwt({issuer,clientId:'oaiapp_http_test',nonce:entry.nonce,issuedAt:Date.now()}),token_type:'Bearer',expires_in:3600,scope:'openid offline_access resource.invoke chatgpt.tokens.use.direct'});
  }
  if(path==='/jwks.json')return send(200,{keys:[jwk]});
  if(path==='/revoke'){res.writeHead(200);return res.end();}
  send(404,{});
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));issuer=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 return{issuer,authorize:(location:string,code:string)=>{const url=new URL(location);pending.set(code,{nonce:url.searchParams.get('nonce')!,challenge:url.searchParams.get('code_challenge')!});return url.searchParams.get('state')!;}};
}

test('HTTP 연결 시작·콜백·상태·해제는 세션, 바인딩 쿠키, Origin을 강제한다',async t=>{
 const idp=await oauthServer(t),keys=['NAEO_APP_URL','NAEO_OPENAI_CLIENT_ID','NAEO_OPENAI_TOKEN_ENCRYPTION_KEY','NAEO_OPENAI_TOKEN_AUTH_METHOD','NAEO_OPENAI_OAUTH_BASE'] as const,before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{NAEO_APP_URL:origin,NAEO_OPENAI_CLIENT_ID:'oaiapp_http_test',NAEO_OPENAI_TOKEN_ENCRYPTION_KEY:'42'.repeat(32),NAEO_OPENAI_TOKEN_AUTH_METHOD:'none',NAEO_OPENAI_OAUTH_BASE:idp.issuer});
 t.after(()=>{for(const key of keys){const value=before[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 const db=fixture(t),account=await member(db),handler=createApi(()=>db),session=`naeo_session=${account.session.token}`;
 const get=(path:string,cookie?:string)=>handler(new Request(origin+path,{headers:cookie?{Cookie:cookie}:{}}));
 assert.equal((await get('/api/account/openai/start')).status,401);
 const started=await get('/api/account/openai/start',session);assert.equal(started.status,302);assert.match(started.headers.get('set-cookie')!,/naeo_openai=.*HttpOnly.*SameSite=Lax/);
 const binding=started.headers.get('set-cookie')!.split(';')[0],state=idp.authorize(started.headers.get('location')!,'http-code');
 const wrong=await get(`/api/account/openai/callback?code=http-code&state=${state}`,session);assert.match(wrong.headers.get('location')!,/openaiError=OPENAI_STATE_INVALID/);
 const restarted=await get('/api/account/openai/start',session),binding2=restarted.headers.get('set-cookie')!.split(';')[0],state2=idp.authorize(restarted.headers.get('location')!,'http-code-2');
 const callback=await get(`/api/account/openai/callback?code=http-code-2&state=${state2}`,`${session}; ${binding2}`);
 assert.equal(callback.headers.get('location'),'/dashboard/settings?openaiConnected=1#openai');
 const status=await (await get('/api/account/openai',session)).json();assert.equal(status.data.connection.connected,true);assert.equal(JSON.stringify(status).includes('http-access-secret'),false);
 const noOrigin=await handler(new Request(origin+'/api/account/openai',{method:'DELETE',headers:{Cookie:session}}));assert.equal(noOrigin.status,403);
 const removed=await handler(new Request(origin+'/api/account/openai',{method:'DELETE',headers:{Cookie:session,Origin:origin}}));assert.equal(removed.status,200);assert.equal((await removed.json()).data.disconnected,true);
 assert.equal(openAIConnection(db,account.user.id).connected,false);assert.ok(binding.startsWith('naeo_openai='));
});
