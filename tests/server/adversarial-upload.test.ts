import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createApi} from '../../src/server/api';
import {decideAuthorization,exchangeToken,registerClient} from '../../src/server/oauth/authz';

const origin='http://127.0.0.1:3000';
/** Generate a large request lazily so the test can prove early cancellation. */
function streamed(prefix:string,suffix:string){
 let pulled=0,canceled=false;
 const total=512,chunk=new Uint8Array(64*1024).fill(65);
 const stream=new ReadableStream<Uint8Array>({pull(c){
  if(pulled===0)c.enqueue(Buffer.from(prefix));
  else if(pulled<=total)c.enqueue(chunk);
  else{c.enqueue(Buffer.from(suffix,'latin1'));c.close();}
  pulled++;
 },cancel(){canceled=true;}});
 return{stream,stats:()=>({pulled,canceled,total})};
}

for(const kind of ['multipart','png','oauth','mcp'] as const)for(const declared of [undefined,'1'])test(`${kind} cancels oversized streams with ${declared?'false':'missing'} Content-Length`,async t=>{
 process.env.NAEO_APP_URL=origin;
 const dir=mkdtempSync(join(tmpdir(),'naeo-adversarial-upload-'));process.env.NAEO_UPLOAD_DIR=dir;
 const db=openDatabase(':memory:');t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});delete process.env.NAEO_UPLOAD_DIR;});
 const {session,user}=await register(db,{email:'bounded@example.test',password:'bounded-test-password',nickname:'Upload',termsAccepted:true});
 let authorization='';
 if(kind==='mcp'){
  const client=registerClient(db,{client_name:'bounded',redirect_uris:['http://127.0.0.1/cb']}),verifier='v'.repeat(43);
  const redirect=decideAuthorization(db,user.id,{client_id:client.client_id,redirect_uri:'http://127.0.0.1/cb',response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),decision:'approve'});
  const token=exchangeToken(db,{grant_type:'authorization_code',code:new URL(redirect).searchParams.get('code'),client_id:client.client_id,redirect_uri:'http://127.0.0.1/cb',code_verifier:verifier});
  authorization=`Bearer ${token.access_token}`;
 }
 const multipart=kind==='multipart';
 const payload=streamed(multipart?'--bound\r\nContent-Disposition: form-data; name="padding"\r\n\r\n':'',multipart?'\r\n--bound\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n\x89PNG\r\n\x1a\n\r\n--bound--\r\n':'');
 const route={multipart:'/api/media',png:'/api/creative/exports/00000000-0000-4000-8000-000000000000/pages/0',oauth:'/api/oauth/token',mcp:'/api/mcp'}[kind];
 const request=new Request(origin+route,{
  method:kind==='png'?'PUT':'POST',body:payload.stream,duplex:'half',
  headers:{Origin:origin,Cookie:`naeo_session=${session.token}`,Authorization:authorization,'Content-Type':multipart?'multipart/form-data; boundary=bound':kind==='png'?'image/png':'application/json',...(declared?{'Content-Length':declared}:{})},
 } as RequestInit);
 const response=await createApi(()=>db)(request);
 assert.equal(response.status,413);
 assert.equal(payload.stats().canceled,true,'oversize stream must be canceled');
 assert.ok(payload.stats().pulled<payload.stats().total,'must stop before consuming the remaining body');
 assert.equal(db.prepare('SELECT count(*) AS n FROM media_files').get()?.n,0);
});
