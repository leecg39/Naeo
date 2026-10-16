import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {balance,grantCredits,ledger} from '../../src/server/credits/ledger';
import {GENERATION_COST,IMAGE_COST,requestGeneration,getGeneration,cancelGeneration,imageGenerationAvailable} from '../../src/server/generation/generation';
import {runGenerationOnce} from '../../src/server/generation/worker';
import {imageConfig,openAIImageProvider,buildImagePrompt} from '../../src/server/generation/image-provider';
import {ProviderError} from '../../src/server/generation/provider';
import {listMedia,readMedia} from '../../src/server/writing/media';
import {getDraft} from '../../src/server/writing/drafts';

const NOW=Date.parse('2026-10-16T00:00:00Z');
const PNG=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(64,1)]);
const textProvider=async()=>({title:'제주 글',body:'## 본문\n\n내용'});
const cfg={provider:'anthropic',model:'m',apiKey:'k',baseUrl:'https://api.anthropic.com'} as const;
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const dir=mkdtempSync(join(tmpdir(),'naeo-img-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const admin=(await register(db,{email:'im-ad@example.test',password:'image-generation-password',nickname:'관리자',termsAccepted:true})).user.id;
 const a=(await register(db,{email:'im-a@example.test',password:'image-generation-password',nickname:'A',termsAccepted:true})).user.id;
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin);
 grantCredits(db,admin,a,{delta:200,note:'QA'});
 const saved={p:process.env.NAEO_IMAGE_PROVIDER,k:process.env.NAEO_IMAGE_API_KEY,b:process.env.NAEO_IMAGE_API_BASE};
 t.after(()=>{for(const [k,v] of [['NAEO_IMAGE_PROVIDER',saved.p],['NAEO_IMAGE_API_KEY',saved.k],['NAEO_IMAGE_API_BASE',saved.b]] as const){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 return{db,admin,a,dir};
}
const on=()=>{process.env.NAEO_IMAGE_PROVIDER='openai';process.env.NAEO_IMAGE_API_KEY='i'.repeat(40);};
const req=(over:Record<string,unknown>={})=>({keyword:'제주 여행',category:'여행',title:'',experience:'',instructions:'',aiImages:0,idempotencyKey:crypto.randomUUID(),...over});

test('image provider config: explicit provider+key, https or loopback only',()=>{
 assert.equal(imageConfig({}),null);
 assert.equal(imageConfig({NAEO_IMAGE_PROVIDER:'openai'}),null,'key required');
 assert.equal(imageConfig({NAEO_IMAGE_PROVIDER:'openai',NAEO_IMAGE_API_KEY:'i'.repeat(40)})!.baseUrl,'https://api.openai.com');
 assert.equal(imageConfig({NAEO_IMAGE_PROVIDER:'openai',NAEO_IMAGE_API_KEY:'i'.repeat(40),NAEO_IMAGE_API_BASE:'http://169.254.169.254'}),null,'non-local http refused');
 assert.equal(imageConfig({NAEO_IMAGE_PROVIDER:'openai',NAEO_IMAGE_API_KEY:'i'.repeat(40),NAEO_IMAGE_API_BASE:'http://127.0.0.1:3999'})!.baseUrl,'http://127.0.0.1:3999');
 assert.equal(imageConfig({NAEO_IMAGE_PROVIDER:'openai',NAEO_IMAGE_API_KEY:'i'.repeat(40)})!.model,'gpt-image-1');
 assert.equal(imageGenerationAvailable(),false);
});

test('OpenAI image adapter: b64 inline image, bounds, error mapping, key in header only',async()=>{
 let seen:{url?:string;auth?:string;body?:unknown}={};let responder:typeof fetch=async()=>new Response('{}',{status:500});
 const provider=openAIImageProvider(imageConfig({NAEO_IMAGE_PROVIDER:'openai',NAEO_IMAGE_API_KEY:'i'.repeat(40),NAEO_IMAGE_API_BASE:'http://127.0.0.1:3999'})!,((url:string|URL|Request,init?:RequestInit)=>responder(url,init)) as typeof fetch);
 responder=async(url,init)=>{seen={url:String(url),auth:String((init?.headers as Record<string,string>)?.authorization),body:JSON.parse(String(init?.body))};return new Response(JSON.stringify({data:[{b64_json:PNG.toString('base64')}]}),{status:200});};
 const img=await provider({prompt:'제주 여행 사진',index:0});
 assert.ok(img.equals(PNG));assert.equal(seen.url,'http://127.0.0.1:3999/v1/images/generations');assert.equal(seen.auth,'Bearer '+'i'.repeat(40));
 assert.equal((seen.body as {n:number}).n,1);assert.equal((seen.body as {prompt:string}).prompt,'제주 여행 사진');
 for(const [status,retryable] of [[401,false],[403,false],[429,true],[500,true]] as const){responder=async()=>new Response(JSON.stringify({error:{message:'no'}}),{status});await assert.rejects(provider({prompt:'x',index:0}),(e:ProviderError)=>e.retryable===retryable);}
 responder=async()=>new Response(JSON.stringify({data:[{url:'https://oaidalle.example/x.png'}]}),{status:200});
 await assert.rejects(provider({prompt:'x',index:0}),{code:'IMAGE_RESPONSE_INVALID'});
 responder=async()=>new Response(JSON.stringify({data:[{b64_json:Buffer.from('not an image').toString('base64')}]}),{status:200});
 await assert.rejects(provider({prompt:'x',index:0}),{code:'IMAGE_RESPONSE_INVALID'});
 responder=async()=>{throw new Error('ECONNREFUSED');};
 await assert.rejects(provider({prompt:'x',index:0}),{code:'IMAGE_PROVIDER_UNAVAILABLE',retryable:true});
});

test('image prompt is bounded and strips control bytes',()=>{
 const p=buildImagePrompt({keyword:'제주 여행',title:'3박4일',category:'여행',instructions:'밝은 분위기\0'.repeat(30)},0);
 assert.ok(p.length<=1000);assert.ok(p.includes('제주 여행'));assert.ok(!p.includes('\0'));
});

test('generation with AI images: charge 10+n, draft holds ai media, imagesMade recorded',async t=>{
 const {db,a,dir}=await fixture(t);on();
 const job=requestGeneration(db,a,req({aiImages:2}),cfg,NOW);
 assert.equal(job.cost,GENERATION_COST+2*IMAGE_COST);assert.equal(balance(db,a),200-job.cost);
 await runGenerationOnce(db,'w',textProvider,{imageProvider:async()=>PNG,uploadDir:dir},()=>NOW+1000);
 const done=getGeneration(db,a,job.id);
 assert.equal(done.state,'succeeded');assert.equal(done.imagesMade,2);assert.equal(done.aiImages,2);assert.equal(done.errorCode,null);
 const media=listMedia(db,a,{draftId:done.draftId});
 assert.equal(media.data.length,2);assert.ok(media.data.every(m=>m.source==='ai'));
 const bytes=readMedia(db,dir,a,media.data[0].publicId).bytes;assert.ok(bytes.equals(PNG));
 assert.equal(getDraft(db,a,done.draftId!).title,'제주 글');
 assert.equal(balance(db,a),200-job.cost,'full charge kept when all images made');
});

test('partial image failure refunds the unused image tokens, job still succeeds',async t=>{
 const {db,a,dir}=await fixture(t);on();
 const job=requestGeneration(db,a,req({aiImages:3}),cfg,NOW);assert.equal(job.cost,13);
 let calls=0;
 await runGenerationOnce(db,'w',textProvider,{imageProvider:async()=>{calls++;if(calls===2)throw new ProviderError('IMAGE_PROVIDER_BUSY','바쁨',true);return PNG;},uploadDir:dir},()=>NOW+1000);
 const done=getGeneration(db,a,job.id);
 assert.equal(done.state,'succeeded');assert.equal(done.imagesMade,1);assert.equal(done.errorCode,'IMAGE_PARTIAL');
 assert.equal(calls,2,'stops after the first failed image');
 assert.equal(balance(db,a),200-GENERATION_COST-IMAGE_COST,'2 unused image tokens refunded');
 const refund=ledger(db,a,{}).data.find(e=>e.reason==='refund');
 assert.equal(refund!.delta,2);assert.match(refund!.note,/2장 미생성/);
});

test('image provider missing at run time refunds all image tokens',async t=>{
 const {db,a,dir}=await fixture(t);on();
 const job=requestGeneration(db,a,req({aiImages:2}),cfg,NOW);
 delete process.env.NAEO_IMAGE_PROVIDER;delete process.env.NAEO_IMAGE_API_KEY;
 await runGenerationOnce(db,'w',textProvider,{imageProvider:null,uploadDir:dir},()=>NOW+1000);
 const done=getGeneration(db,a,job.id);
 assert.equal(done.state,'succeeded');assert.equal(done.imagesMade,0);assert.equal(done.errorCode,'IMAGE_PARTIAL');
 assert.equal(balance(db,a),200-GENERATION_COST,'image tokens returned');
});

test('cancel during image generation cancels and refunds the whole cost',async t=>{
 const {db,a,dir}=await fixture(t);on();
 const job=requestGeneration(db,a,req({aiImages:5}),cfg,NOW);
 let calls=0;
 await runGenerationOnce(db,'w',textProvider,{imageProvider:async()=>{if(!calls++)cancelGeneration(db,a,job.id);return PNG;},uploadDir:dir},()=>NOW+1000);
 const done=getGeneration(db,a,job.id);
 assert.equal(done.state,'canceled');assert.equal(done.draftId,null);
 assert.equal(balance(db,a),200,'full refund on cancel');
});

test('draft capacity caps AI images and refunded tokens',async t=>{
 const {db,a,dir}=await fixture(t);on();
 const photos=await Promise.all(Array.from({length:18},(_,i)=>import('../../src/server/writing/media').then(m=>m.saveUpload(db,dir,a,{bytes:PNG,name:`p${i}.png`,type:'image/png'}))));
 const job=requestGeneration(db,a,req({aiImages:5,photoIds:photos.map(p=>p.publicId)}),cfg,NOW);
 assert.equal(job.cost,GENERATION_COST+2*IMAGE_COST,'capped to the remaining draft room');
 await runGenerationOnce(db,'w',textProvider,{imageProvider:async()=>PNG,uploadDir:dir},()=>NOW+1000);
 const done=getGeneration(db,a,job.id);
 assert.equal(done.state,'succeeded');assert.equal(done.imagesMade,2);
 assert.equal(listMedia(db,a,{draftId:done.draftId}).data.length,20);
});

test('aiImages still refused when image provider unconfigured; photoIds validated',async t=>{
 const {db,a}=await fixture(t);
 assert.throws(()=>requestGeneration(db,a,req({aiImages:1}),cfg,NOW),{status:503,code:'IMAGE_PROVIDER_NOT_CONFIGURED'});
 assert.equal(balance(db,a),200);
 on();
 assert.throws(()=>requestGeneration(db,a,req({aiImages:1,photoIds:['x'.repeat(22)]}),cfg,NOW),{status:404,code:'PHOTO_NOT_FOUND'});
});
