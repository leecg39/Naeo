import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {changePassword} from '../../src/server/account-security';
import {updateUser} from '../../src/server/admin-users';
import {registerClient,ensureExtensionClient,validateAuthorizeRequest,decideAuthorization,exchangeToken,authenticateBearer,revokeToken,revokeAppForUser,listAuthorizedApps,mcpResource} from '../../src/server/oauth/authz';

process.env.NAEO_APP_URL='http://127.0.0.1:3000';
const NOW=Date.parse('2026-10-14T03:00:00Z');
const verifier='v'.repeat(20)+'-verifier-for-pkce-tests-0123456789';
const challenge=createHash('sha256').update(verifier).digest('base64url');
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const user=(await register(db,{email:'u@example.test',password:'authz-long-password',nickname:'U',termsAccepted:true})).user.id;
 const client=registerClient(db,{client_name:'Claude',redirect_uris:['https://claude.ai/api/mcp/auth_callback','http://127.0.0.1:6274/oauth/callback']},NOW);
 return{db,user,client};
}
const params=(client:{client_id:string},over:Record<string,string>={})=>({response_type:'code',client_id:client.client_id,redirect_uri:'https://claude.ai/api/mcp/auth_callback',state:'st-1',code_challenge:challenge,code_challenge_method:'S256',scope:'naeo:read naeo:write',resource:mcpResource(),...over});
function codeFrom(url:string){const u=new URL(url);return{code:u.searchParams.get('code'),state:u.searchParams.get('state'),error:u.searchParams.get('error')};}
async function tokens(db:ReturnType<typeof openDatabase>,user:string,client:{client_id:string},over:Record<string,string>={}){
 const {code}=codeFrom(decideAuthorization(db,user,{...params(client,over),decision:'approve'},NOW));
 return exchangeToken(db,{grant_type:'authorization_code',code:code!,redirect_uri:'https://claude.ai/api/mcp/auth_callback',client_id:client.client_id,code_verifier:verifier,resource:mcpResource()},NOW);
}

test('dynamic client registration only accepts https or loopback redirect URIs',async t=>{
 const {db,client}=await fixture(t);
 assert.match(client.client_id,/^[A-Za-z0-9_-]{20,}$/);
 assert.equal(client.token_endpoint_auth_method,'none');
 assert.throws(()=>registerClient(db,{client_name:'x',redirect_uris:['http://evil.example/cb']},NOW),{code:'invalid_redirect_uri'});
 assert.throws(()=>registerClient(db,{client_name:'x',redirect_uris:['javascript:alert(1)']},NOW),{code:'invalid_redirect_uri'});
 assert.throws(()=>registerClient(db,{redirect_uris:['https://ok.example/cb']},NOW),{code:'invalid_client_metadata'});
 const ext=ensureExtensionClient(db,'abcdefghijklmnopabcdefghijklmnop',NOW);
 assert.deepEqual(ext.redirect_uris,['https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/']);
 assert.equal(ensureExtensionClient(db,'abcdefghijklmnopabcdefghijklmnop',NOW).client_id,ext.client_id,'stable per extension');
 assert.throws(()=>ensureExtensionClient(db,'not-an-extension-id',NOW),{code:'INVALID_EXTENSION'});
});

test('authorize: bad client or redirect is shown, other problems go back to the app; PKCE S256 required',async t=>{
 const {db,user,client}=await fixture(t);
 assert.throws(()=>validateAuthorizeRequest(db,params({client_id:'unknown-client-id'})),{code:'INVALID_CLIENT'});
 assert.throws(()=>validateAuthorizeRequest(db,params(client,{redirect_uri:'https://claude.ai/other'})),{code:'INVALID_REDIRECT'});
 assert.equal(codeFrom(decideAuthorization(db,user,{...params(client,{code_challenge_method:'plain'}),decision:'approve'},NOW)).error,'invalid_request');
 assert.equal(codeFrom(decideAuthorization(db,user,{...params(client,{scope:'naeo:read admin'}),decision:'approve'},NOW)).error,'invalid_scope');
 assert.equal(codeFrom(decideAuthorization(db,user,{...params(client,{resource:'https://evil.example/mcp'}),decision:'approve'},NOW)).error,'invalid_target');
 const denied=codeFrom(decideAuthorization(db,user,{...params(client),decision:'deny'},NOW));
 assert.deepEqual([denied.error,denied.state],['access_denied','st-1']);
 const ok=validateAuthorizeRequest(db,params(client,{scope:''}));
 assert.equal(ok.scope,'naeo:read naeo:write','default scope');
 assert.equal(ok.clientName,'Claude');
});

test('token: one-time code bound to verifier, redirect and resource; bearer checks audience, expiry and revocation',async t=>{
 const {db,user,client}=await fixture(t);
 const url=decideAuthorization(db,user,{...params(client),decision:'approve'},NOW);
 const {code,state}=codeFrom(url);assert.equal(state,'st-1');
 const base={grant_type:'authorization_code',code:code!,redirect_uri:'https://claude.ai/api/mcp/auth_callback',client_id:client.client_id,resource:mcpResource()};
 assert.throws(()=>exchangeToken(db,{...base,code_verifier:'wrong-verifier-wrong-verifier-wrong-verifier'},NOW),{code:'invalid_grant'});
 const t1=exchangeToken(db,{...base,code_verifier:verifier},NOW);
 assert.equal(t1.token_type,'Bearer');assert.equal(t1.expires_in,3600);assert.equal(t1.scope,'naeo:read naeo:write');
 assert.throws(()=>exchangeToken(db,{...base,code_verifier:verifier},NOW),{code:'invalid_grant'},'codes are single use');
 const late=codeFrom(decideAuthorization(db,user,{...params(client),decision:'approve'},NOW));
 assert.throws(()=>exchangeToken(db,{...base,code:late.code!,code_verifier:verifier},NOW+6*60_000),{code:'invalid_grant'},'5-minute codes');
 const who=authenticateBearer(db,`Bearer ${t1.access_token}`,mcpResource(),NOW+1000);
 assert.deepEqual([who.userId,who.clientId,who.scopes],[user,client.client_id,['naeo:read','naeo:write']]);
 assert.throws(()=>authenticateBearer(db,`Bearer ${t1.access_token}`,'http://127.0.0.1:3000/api/other',NOW),{status:401},'audience bound');
 assert.throws(()=>authenticateBearer(db,`Bearer ${t1.access_token}`,mcpResource(),NOW+3601_000),{status:401},'1-hour access tokens');
 assert.throws(()=>authenticateBearer(db,`Bearer ${t1.refresh_token}`,mcpResource(),NOW),{status:401},'refresh tokens are not bearer tokens');
 assert.throws(()=>authenticateBearer(db,undefined,mcpResource(),NOW),{status:401});
 revokeToken(db,{token:t1.access_token});
 assert.throws(()=>authenticateBearer(db,`Bearer ${t1.access_token}`,mcpResource(),NOW),{status:401});
});

test('refresh tokens rotate; replaying an old one revokes the whole family; users can disconnect apps',async t=>{
 const {db,user,client}=await fixture(t);
 const first=await tokens(db,user,client);
 const second=exchangeToken(db,{grant_type:'refresh_token',refresh_token:first.refresh_token,client_id:client.client_id},NOW+1000);
 assert.notEqual(second.refresh_token,first.refresh_token);
 assert.throws(()=>exchangeToken(db,{grant_type:'refresh_token',refresh_token:first.refresh_token,client_id:client.client_id},NOW+2000),{code:'invalid_grant'});
 assert.throws(()=>authenticateBearer(db,`Bearer ${second.access_token}`,mcpResource(),NOW+3000),{status:401},'reuse detection revokes the family');
 const fresh=await tokens(db,user,client);
 const apps=listAuthorizedApps(db,user);
 assert.equal(apps.length,1);assert.equal(apps[0].name,'Claude');assert.deepEqual(apps[0].scopes,['naeo:read','naeo:write']);
 revokeAppForUser(db,user,client.client_id);
 assert.throws(()=>authenticateBearer(db,`Bearer ${fresh.access_token}`,mcpResource(),NOW),{status:401});
 assert.throws(()=>exchangeToken(db,{grant_type:'refresh_token',refresh_token:fresh.refresh_token,client_id:client.client_id},NOW),{code:'invalid_grant'});
 assert.equal(listAuthorizedApps(db,user).length,0);
});

test('disconnecting an app also invalidates every outstanding authorization code',async t=>{
 const {db,user,client}=await fixture(t);await tokens(db,user,client);
 const pending=codeFrom(decideAuthorization(db,user,{...params(client),decision:'approve'},NOW));
 revokeAppForUser(db,user,client.client_id,NOW+1);
 assert.throws(()=>exchangeToken(db,{grant_type:'authorization_code',code:pending.code!,client_id:client.client_id,redirect_uri:params(client).redirect_uri,code_verifier:verifier},NOW+2),{code:'invalid_grant'});
});

test('suspension and password changes invalidate app grants, including codes pending exchange',async t=>{
 const {db,user,client}=await fixture(t),first=await tokens(db,user,client);
 const admin=(await register(db,{email:'admin-grants@example.test',password:'authz-admin-password',nickname:'Admin',termsAccepted:true})).user.id;
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin);
 const pending=codeFrom(decideAuthorization(db,user,{...params(client),decision:'approve'},NOW));
 await updateUser(db,admin,user,{status:'suspended',version:1,currentPassword:'authz-admin-password'});
 assert.throws(()=>exchangeToken(db,{grant_type:'refresh_token',refresh_token:first.refresh_token,client_id:client.client_id},NOW+1),{code:'invalid_grant'});
 assert.throws(()=>exchangeToken(db,{grant_type:'authorization_code',code:pending.code!,client_id:client.client_id,redirect_uri:params(client).redirect_uri,code_verifier:verifier},NOW+1),{code:'invalid_grant'});
 await updateUser(db,admin,user,{status:'active',version:2,currentPassword:'authz-admin-password'});
 assert.throws(()=>authenticateBearer(db,`Bearer ${first.access_token}`,mcpResource(),NOW+2),{status:401},'reactivating an account does not reactivate old access tokens');
 const fresh=await tokens(db,user,client);
 await changePassword(db,user,{currentPassword:'authz-long-password',newPassword:'changed-authz-password'});
 assert.throws(()=>authenticateBearer(db,`Bearer ${fresh.access_token}`,mcpResource(),NOW+3),{status:401});
});

test('refresh audience mismatch is rejected without consuming the current refresh token',async t=>{
 const {db,user,client}=await fixture(t),first=await tokens(db,user,client);
 const grant={grant_type:'refresh_token',refresh_token:first.refresh_token,client_id:client.client_id};
 assert.throws(()=>exchangeToken(db,{...grant,resource:'https://unrelated.example/mcp'},NOW+1),{code:'invalid_target'});
 assert.ok(exchangeToken(db,grant,NOW+2).access_token);
});

test('legacy grants owned by an inactive account cannot issue new tokens',async t=>{
 const {db,user,client}=await fixture(t),first=await tokens(db,user,client);
 db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(user);
 const before=db.prepare('SELECT count(*) AS n FROM oauth_tokens').get()?.n;
 assert.throws(()=>exchangeToken(db,{grant_type:'refresh_token',refresh_token:first.refresh_token,client_id:client.client_id},NOW+1),{code:'invalid_grant'});
 assert.equal(db.prepare('SELECT count(*) AS n FROM oauth_tokens').get()?.n,before);
});
