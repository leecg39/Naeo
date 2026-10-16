import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openDatabase} from '../../src/server/database';
import {createApi} from '../../src/server/api';
import {createBlog} from '../../src/server/blogs';
import {authorizationServerMetadata,protectedResourceMetadata} from '../../src/server/oauth/metadata';
import {ensureExtensionClient} from '../../src/server/oauth/authz';

const origin='http://127.0.0.1:3000';
process.env.NAEO_APP_URL=origin;
const verifier='mcp-test-verifier-0123456789-abcdefghijklmnopqrstuvwxyz';
const challenge=createHash('sha256').update(verifier).digest('base64url');
const REDIRECT='http://127.0.0.1:6274/oauth/callback';
function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const handler=createApi(()=>db);
 const call=(p:string,init:{method?:string;body?:string;headers?:Record<string,string>}={})=>handler(new Request(origin+p,{method:init.method??'GET',headers:init.headers??{},...(init.body!==undefined?{body:init.body}:{})}));
 const site=(p:string,method:string,body:unknown,cookie:string)=>call(p,{method,body:JSON.stringify(body),headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie}});
 return{db,call,site};
}
/** 실제 MCP 클라이언트가 하는 순서: 등록 → (사용자 동의) → 코드 교환. */
async function connect(f:ReturnType<typeof fixture>,cookie:string,scope:string){
 const reg=await (await f.call('/api/oauth/register',{method:'POST',body:JSON.stringify({client_name:'Test MCP Client',redirect_uris:[REDIRECT]}),headers:{'Content-Type':'application/json'}})).json();
 const params={response_type:'code',client_id:reg.client_id,redirect_uri:REDIRECT,state:'s1',code_challenge:challenge,code_challenge_method:'S256',scope,resource:`${origin}/api/mcp`};
 const auth=await (await f.site('/api/oauth/authorize','POST',{...params,decision:'approve'},cookie)).json();
 const code=new URL(auth.data.redirect).searchParams.get('code')!;
 const tok=await f.call('/api/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:REDIRECT,client_id:reg.client_id,code_verifier:verifier,resource:`${origin}/api/mcp`}).toString()});
 return{client:reg.client_id as string,token:await tok.json() as {access_token:string;refresh_token:string},status:tok.status};
}
const mcp=(f:ReturnType<typeof fixture>,token:string,body:unknown,extra:Record<string,string>={})=>f.call('/api/mcp',{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:`Bearer ${token}`,...extra}});

test('extension MCP requests require an allowed origin and a token for that exact extension',async t=>{
 const f=fixture(t),id='a'.repeat(32),other='b'.repeat(32);
 const previous=process.env.NAEO_EXTENSION_IDS;
 process.env.NAEO_EXTENSION_IDS=` ${id},${other} `;
 t.after(()=>{if(previous===undefined)delete process.env.NAEO_EXTENSION_IDS;else process.env.NAEO_EXTENSION_IDS=previous;});
 const registration=await f.site('/api/auth/register','POST',{email:'extension@example.test',password:'extension-long-password',nickname:'확장 회원',termsAccepted:true},'');
 assert.equal(registration.status,201);
 const cookie=registration.headers.get('set-cookie')!.split(';')[0];
 const client=ensureExtensionClient(f.db,id),redirect=client.redirect_uris[0];
 const authorization=await f.site('/api/oauth/authorize','POST',{response_type:'code',client_id:client.client_id,redirect_uri:redirect,state:'extension-state',code_challenge:challenge,code_challenge_method:'S256',scope:'naeo:read',decision:'approve'},cookie);
 assert.equal(authorization.status,200);
 const callback=new URL((await authorization.json()).data.redirect);
 assert.equal(callback.searchParams.get('state'),'extension-state');
 const exchange=await f.call('/api/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:`chrome-extension://${id}`},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.client_id,redirect_uri:redirect,code:callback.searchParams.get('code')!,code_verifier:verifier}).toString()});
 assert.equal(exchange.status,200);const token=(await exchange.json()).access_token;
 const ping={jsonrpc:'2.0',id:1,method:'ping'};
 const accepted=await mcp(f,token,ping,{Origin:`chrome-extension://${id}`});
 assert.equal(accepted.status,200);assert.deepEqual((await accepted.json()).result,{});
 assert.equal((await mcp(f,token,ping,{Origin:`chrome-extension://${other}`})).status,403);
 for(const invalid of [`chrome-extension://${'c'.repeat(32)}`,`chrome-extension://${id}.evil.test`,`chrome-extension://${id}/path`,'null','https://evil.example'])
  assert.equal((await mcp(f,token,ping,{Origin:invalid})).status,403,invalid);
 const regular=await connect(f,cookie,'naeo:read');
 assert.equal((await mcp(f,regular.token.access_token,ping,{Origin:`chrome-extension://${id}`})).status,403);
 assert.equal((await mcp(f,'invalid',ping,{Origin:`chrome-extension://${id}`})).status,401);
 const denied=await mcp(f,token,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'naeo_create_draft',arguments:{title:'권한 없음'}}},{Origin:`chrome-extension://${id}`});
 assert.equal((await denied.json()).result.isError,true);
 process.env.NAEO_EXTENSION_IDS=other;
 assert.equal((await mcp(f,token,ping,{Origin:`chrome-extension://${id}`})).status,403);
});

test('metadata documents advertise the endpoints MCP clients discover',()=>{
 const as=authorizationServerMetadata(),pr=protectedResourceMetadata();
 assert.equal(as.issuer,origin);assert.equal(as.authorization_endpoint,`${origin}/oauth/consent`);assert.deepEqual(as.code_challenge_methods_supported,['S256']);
 assert.equal(pr.resource,`${origin}/api/mcp`);assert.deepEqual(pr.authorization_servers,[origin]);
});

test('MCP over HTTP: discovery 401, initialize, tools, scopes, Origin, notifications, revocation',async t=>{
 const f=fixture(t);
 const r=await f.call('/api/auth/register',{method:'POST',body:JSON.stringify({email:'m@example.test',password:'mcp-long-password',nickname:'M',termsAccepted:true}),headers:{Origin:origin,'Content-Type':'application/json'}});
 const cookie=r.headers.get('set-cookie')!.split(';')[0],userId=(await r.json()).data.user.id;
 createBlog(f.db,userId,{naverId:'m_blog',title:'M 블로그',category:'',isPrimary:true});
 const anon=await f.call('/api/mcp',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}});
 assert.equal(anon.status,401);
 assert.match(anon.headers.get('www-authenticate')!,/resource_metadata="http:\/\/127\.0\.0\.1:3000\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
 assert.equal((await f.call('/api/oauth/authorize',{method:'POST',body:'{}',headers:{'Content-Type':'application/json',Cookie:cookie}})).status,403,'consent decisions need the site origin');
 const read=await connect(f,cookie,'naeo:read');
 assert.equal(read.status,200);
 const init=await (await mcp(f,read.token.access_token,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'t',version:'1'}}})).json();
 assert.equal(init.result.protocolVersion,'2025-06-18');assert.equal(init.result.serverInfo.name,'naeo');
 assert.equal((await mcp(f,read.token.access_token,{jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
 const list=await (await mcp(f,read.token.access_token,{jsonrpc:'2.0',id:2,method:'tools/list'},{'MCP-Protocol-Version':'2025-06-18'})).json();
 assert.ok(list.result.tools.some((x:{name:string})=>x.name==='naeo_create_draft'));
 const status=await (await mcp(f,read.token.access_token,{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'naeo_blog_status',arguments:{}}})).json();
 assert.equal(status.result.isError,false);assert.equal(status.result.structuredContent.blog.naverId,'m_blog');
 const denied=await (await mcp(f,read.token.access_token,{jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'naeo_create_draft',arguments:{title:'x'}}})).json();
 assert.equal(denied.result.isError,true);assert.match(denied.result.content[0].text,/naeo:write/);
 const write=await connect(f,cookie,'naeo:read naeo:write naeo:generate');
 const made=await (await mcp(f,write.token.access_token,{jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'naeo_create_draft',arguments:{title:'MCP로 만든 초안',body:'## 본문'}}})).json();
 assert.equal(made.result.isError,false);
 assert.equal((f.db.prepare('SELECT title FROM drafts WHERE owner_id=?').get(userId) as {title:string}).title,'MCP로 만든 초안');
 const gen=await (await mcp(f,write.token.access_token,{jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'naeo_request_generation',arguments:{keyword:'제주',idempotencyKey:'k1'}}})).json();
 assert.equal(gen.result.isError,true);assert.match(gen.result.content[0].text,/미설정/);
 const bad=await (await mcp(f,write.token.access_token,{jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'naeo_get_draft',arguments:{id:'not-a-uuid'}}})).json();
 assert.equal(bad.result.isError,true);
 assert.equal((await (await mcp(f,write.token.access_token,{jsonrpc:'2.0',id:8,method:'tools/call',params:{name:'nope',arguments:{}}})).json()).error.code,-32602);
 assert.equal((await (await mcp(f,write.token.access_token,{jsonrpc:'2.0',id:9,method:'resources/list'})).json()).error.code,-32601);
 assert.equal((await mcp(f,write.token.access_token,{jsonrpc:'2.0',id:10,method:'ping'},{Origin:'https://evil.example'})).status,403,'DNS rebinding guard');
 assert.equal((await f.call('/api/mcp',{headers:{Authorization:`Bearer ${write.token.access_token}`}})).status,405);
 assert.equal((f.db.prepare('SELECT count(*) AS n FROM mcp_calls WHERE user_id=?').get(userId) as {n:number}).n,5,'tool calls are recorded');
 const apps=await (await f.site('/api/account/apps','GET',undefined,cookie)).json();
 assert.equal(apps.data.length,2);
 assert.equal((await f.site(`/api/account/apps/${write.client}`,'DELETE',undefined,cookie)).status,200);
 const after=await mcp(f,write.token.access_token,{jsonrpc:'2.0',id:11,method:'ping'});
 assert.equal(after.status,401);assert.match(after.headers.get('www-authenticate')!,/error="invalid_token"/);
 const refresh=await f.call('/api/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:write.token.refresh_token,client_id:write.client}).toString()});
 assert.equal(refresh.status,400);assert.equal((await refresh.json()).error,'invalid_grant');
 assert.equal((await f.call('/api/oauth/register',{method:'POST',body:JSON.stringify({client_name:'x',redirect_uris:['http://evil.example/cb']}),headers:{'Content-Type':'application/json'}})).status,400);
});
