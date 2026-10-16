import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {searchAdConfig,keywordStats,volumeOf,normalizePhrase} from '../../src/server/keywords/searchad';
import {naverSearchConfig,blogSearch,cleanText} from '../../src/server/competitors/naver-search';
import {checkExposure,listExposures,getExposure,remainingExposuresToday,EXPOSURE_DAILY_LIMIT} from '../../src/server/competitors/exposure';
import {collectKeywordMetrics} from '../../src/server/keywords/collect';
import {createKeyword,addKeywordMetric,listAdminKeywords} from '../../src/server/keywords/admin-keywords';
import {addCompetitor} from '../../src/server/competitors/competitors';
import {ProviderError} from '../../src/server/generation/provider';
import {runRetention} from '../../src/server/ops/retention';
import type {FetchLike} from '../../src/server/generation/provider';

const NOW=Date.parse('2026-10-16T12:00:00Z');
const ADS_ENV={NAEO_SEARCHAD_API_KEY:'license_key_0123456789',NAEO_SEARCHAD_SECRET:'secret_value_0123456789',NAEO_SEARCHAD_CUSTOMER_ID:'1234567',NAEO_SEARCHAD_BASE:'http://127.0.0.1:3301'};
const NV_ENV={NAEO_NAVER_CLIENT_ID:'client_id_0123456789',NAEO_NAVER_CLIENT_SECRET:'client_secret_0123',NAEO_NAVER_SEARCH_BASE:'http://127.0.0.1:3302'};
const ads=()=>searchAdConfig(ADS_ENV)!;
const nv=()=>naverSearchConfig(NV_ENV)!;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const statsList=(rows:Record<string,unknown>[])=>json({keywordList:rows});
const blogList=(items:Record<string,unknown>[],total=items.length)=>json({lastBuildDate:'x',total,start:1,display:items.length,items});

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const admin=(await register(db,{email:'s-ad@example.test',password:'search-password-1',nickname:'관리자',termsAccepted:true})).user.id;
 const a=(await register(db,{email:'s-a@example.test',password:'search-password-1',nickname:'A',termsAccepted:true})).user.id;
 const b=(await register(db,{email:'s-b@example.test',password:'search-password-1',nickname:'B',termsAccepted:true})).user.id;
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin);
 db.prepare("INSERT INTO blogs(id,owner_id,naver_id,title,created_at,updated_at) VALUES('00000000-0000-4000-8000-00000000bb01',?,'mine_blog','내 블로그',?,?)").run(a,NOW,NOW);
 return{db,admin,a,b};
}

test('searchAdConfig: all three keys required, https or loopback only',()=>{
 assert.equal(searchAdConfig({}),null);
 assert.equal(searchAdConfig({NAEO_SEARCHAD_API_KEY:'x'.repeat(12),NAEO_SEARCHAD_SECRET:'s',NAEO_SEARCHAD_CUSTOMER_ID:'12a'}),null,'customer id must be digits');
 assert.equal(searchAdConfig({...ADS_ENV,NAEO_SEARCHAD_BASE:'http://169.254.169.254'}),null,'non-local http refused');
 assert.equal(searchAdConfig({NAEO_SEARCHAD_API_KEY:'k'.repeat(12),NAEO_SEARCHAD_SECRET:'s',NAEO_SEARCHAD_CUSTOMER_ID:'123456'})!.baseUrl,'https://api.searchad.naver.com');
 assert.ok(ads().baseUrl.startsWith('http://127.0.0.1'));
});

test('keywordStats: HMAC signature, exact-phrase match, bounded fields, error mapping, key in headers only',async()=>{
 let seen:{url?:string;h?:Record<string,string>}={};let responder:typeof fetch=async()=>json({});
 const call=(phrases:string[])=>keywordStats(ads(),phrases,((url:string|URL|Request,init?:RequestInit)=>{seen={url:String(url),h:init?.headers as Record<string,string>};return responder(url,init);}) as FetchLike);
 responder=async()=>statsList([
  {relKeyword:'제주 여행',monthlyPcQcCnt:1900,monthlyMobileQcCnt:'< 10',compIdx:'높음'},
  {relKeyword:'제주여행 맛집',monthlyPcQcCnt:100,monthlyMobileQcCnt:200,compIdx:'중간'},
  {relKeyword:'jeju trip',monthlyPcQcCnt:5,monthlyMobileQcCnt:6,compIdx:'낮음'}]);
 const out=await call(['제주여행','Jeju Trip']);
 assert.equal(out.size,2,'related-but-different phrase is not returned');
 assert.equal(out.get(normalizePhrase('제주여행'))!.pcVolume,1900);
 assert.equal(out.get(normalizePhrase('제주여행'))!.mobileVolume,9,'"< 10" maps to upper bound minus one');
 assert.match(seen.url!,/\/keywordstool\?hintKeywords=/);
 assert.ok(!seen.url!.includes(ADS_ENV.NAEO_SEARCHAD_API_KEY)&&!seen.url!.includes(ADS_ENV.NAEO_SEARCHAD_SECRET),'key never in URL');
 const ts=seen.h!['x-timestamp'];
 assert.equal(seen.h!['x-api-key'],ADS_ENV.NAEO_SEARCHAD_API_KEY);
 assert.equal(seen.h!['x-customer'],ADS_ENV.NAEO_SEARCHAD_CUSTOMER_ID);
 assert.equal(seen.h!['x-api-signature'],createHmac('sha256',ADS_ENV.NAEO_SEARCHAD_SECRET).update(`${ts}.GET./keywordstool`).digest('base64'));
 for(const [status,retryable] of [[400,false],[401,false],[403,false],[429,true],[500,true]] as const){
  responder=async()=>json({title:'err'},status);
  await assert.rejects(call(['x']), (e:ProviderError)=>e.retryable===retryable);
 }
 responder=async()=>{throw new Error('ECONNREFUSED');};
 await assert.rejects(call(['x']),{code:'SEARCHAD_UNAVAILABLE',retryable:true});
 await assert.rejects(keywordStats(ads(),[],async()=>json({})),{code:'SEARCHAD_REQUEST'});
 await assert.rejects(keywordStats(ads(),['1','2','3','4','5','6'],async()=>json({})),{code:'SEARCHAD_REQUEST'},'max 5 hints');
 assert.equal(volumeOf('< 10'),9);assert.equal(volumeOf(1500.7),1500);assert.equal(volumeOf('abc'),0);
 assert.equal(normalizePhrase('제주 여행'),normalizePhrase('제주여행'));
});

test('naverSearchConfig + blogSearch: item cleanup, total, error mapping, secrets in headers only',async()=>{
 assert.equal(naverSearchConfig({}),null);
 assert.equal(naverSearchConfig({...NV_ENV,NAEO_NAVER_SEARCH_BASE:'http://example.com'}),null);
 let seen:{url?:string;h?:Record<string,string>}={};let responder:typeof fetch=async()=>json({});
 const call=(q:string)=>blogSearch(nv(),q,{display:20},((url:string|URL|Request,init?:RequestInit)=>{seen={url:String(url),h:init?.headers as Record<string,string>};return responder(url,init);}) as FetchLike);
 responder=async()=>blogList([{title:'<b>제주</b> 여행 &quot;코스&quot;',link:'https://blog.naver.com/someone/123',bloggername:'누군가',bloggerlink:'https://blog.naver.com/someone',postdate:'20261001'}],43210);
 const out=await call('제주 여행');
 assert.equal(out.total,43210);
 assert.equal(out.items[0].title,'제주 여행 "코스"');assert.equal(out.items[0].postDate,'2026-10-01');
 assert.match(seen.url!,/\/v1\/search\/blog\.json\?query=/);
 assert.ok(!seen.url!.includes(NV_ENV.NAEO_NAVER_CLIENT_SECRET),'secret never in URL');
 assert.equal(seen.h!['x-naver-client-id'],NV_ENV.NAEO_NAVER_CLIENT_ID);
 for(const [status,code,retryable] of [[400,'SE01',false],[403,'024',false],[429,'012',true],[500,'SE99',true]] as const){
  responder=async()=>json({errorMessage:'err',errorCode:code},status);
  await assert.rejects(call('x'),(e:ProviderError)=>e.retryable===retryable);
 }
 assert.equal(cleanText('<b>a</b>&amp;b',20),'a&b');
});

test('checkExposure: config gate, marking, persistence, quota, isolation',async t=>{
 const {db,a,b}=await fixture(t);
 addCompetitor(db,a,{blog:'rival_blog'},NOW);
 const items=[
  {title:'경쟁 글',link:'https://blog.naver.com/rival_blog/11',bloggername:'r',bloggerlink:'',postdate:'20261010'},
  {title:'내 글',link:'https://blog.naver.com/mine_blog/22',bloggername:'m',bloggerlink:'',postdate:'20261009'},
  {title:'남의 글',link:'https://blog.naver.com/stranger/33',bloggername:'s',bloggerlink:'',postdate:'20261008'},
  {title:'외부',link:'https://tistory.example/post',bloggername:'x',bloggerlink:'',postdate:'20261007'}];
 const stub=(list=items,total=777):FetchLike=>(async()=>blogList(list,total)) as FetchLike;
 await assert.rejects(checkExposure(db,a,{keyword:'제주 여행'},{config:null},NOW),{status:503,code:'SEARCH_NOT_CONFIGURED'});
 const e=await checkExposure(db,a,{keyword:' 제주 여행 '},{config:nv(),fetchImpl:stub()},NOW);
 assert.equal(e.keyword,'제주 여행');assert.equal(e.total,777);assert.equal(e.hits.length,4);
 assert.equal(e.hits[0].kind,'competitor');assert.equal(e.hits[0].naverId,'rival_blog');
 assert.equal(e.hits[1].kind,'mine');assert.equal(e.hits[2].kind,'other');assert.equal(e.hits[3].naverId,null,'non-naver host unmarked');
 assert.equal(listExposures(db,a).length,1);assert.equal(listExposures(db,b).length,0,'members isolated');
 assert.equal((await checkExposure(db,b,{keyword:'제주 여행'},{config:nv(),fetchImpl:stub()},NOW)).hits[0].kind,'other','competitor marks are per-member');
 assert.equal(getExposure(db,a,e.id).id,e.id);
 assert.throws(()=>getExposure(db,b,e.id),{status:404},'cannot read another member\'s check');
 const failing:FetchLike=(async()=>json({errorMessage:'x',errorCode:'SE99'},500)) as FetchLike;
 await assert.rejects(checkExposure(db,a,{keyword:'x'},{config:nv(),fetchImpl:failing},NOW),{code:'NAVER_SEARCH_UNAVAILABLE'});
 assert.equal(listExposures(db,a).length,1,'failed calls are not recorded');
 for(let i=0;i<EXPOSURE_DAILY_LIMIT-1;i++)await checkExposure(db,a,{keyword:`k${i}`},{config:nv(),fetchImpl:stub([],0)},NOW);
 assert.equal(remainingExposuresToday(db,a,NOW),0);
 await assert.rejects(checkExposure(db,a,{keyword:'over'},{config:nv(),fetchImpl:stub()},NOW),{status:429,code:'EXPOSURE_QUOTA_EXCEEDED'});
 assert.equal(remainingExposuresToday(db,b,NOW),EXPOSURE_DAILY_LIMIT-1,'b used one check earlier');
});

test('collectKeywordMetrics: admin gate, batches of 5, document count, missing/failed reporting',async t=>{
 const {db,admin,a}=await fixture(t);
 const words=await Promise.all(['제주 여행','서울 맛집','부산 카페','강릉 바다','대전 빵','전주 한옥'].map(p=>createKeyword(db,admin,{phrase:p},NOW)));
 addKeywordMetric(db,admin,words[0].id,{pcVolume:1,mobileVolume:1,documentCount:500});
 await assert.rejects(collectKeywordMetrics(db,a,{}, {searchAd:ads(),fetchImpl:async()=>statsList([])},NOW),{status:403});
 await assert.rejects(collectKeywordMetrics(db,admin,{},{searchAd:null},NOW),{status:503,code:'SEARCHAD_NOT_CONFIGURED'});
 const calls:string[]=[];
 const fetcher:FetchLike=(async(url:string|URL|Request)=>{
  const u=new URL(String(url));
  if(u.pathname==='/keywordstool'){
   calls.push(u.searchParams.get('hintKeywords')!);
   const rels=(u.searchParams.get('hintKeywords')??'').split(',').flatMap(p=>p==='대전 빵'?[]:[{relKeyword:p,monthlyPcQcCnt:1000,monthlyMobileQcCnt:2000,compIdx:'중간'}]);
   return statsList(rels);
  }
  if(u.pathname==='/v1/search/blog.json')return blogList([],6400);
  return json({},404);
 }) as FetchLike;
 const r=await collectKeywordMetrics(db,admin,{},{searchAd:ads(),search:nv(),fetchImpl:fetcher},NOW);
 assert.equal(calls.length,2,'6 keywords in batches of 5');
 assert.equal(r.measured.length,5);assert.deepEqual(r.missing,['대전 빵']);assert.equal(r.failed.length,0);
 assert.equal(r.measured[0].documentCount,6400,'document count from naver search');
 assert.equal(r.documents,'naver_search');
 const latest=listAdminKeywords(db,admin,{page:1,pageSize:10,q:'',status:'active',category:''}).data.find(k=>k.phrase==='제주 여행')!.latest!;
 assert.equal(latest.source,'naver_searchad');assert.equal(latest.pcVolume,1000);
 const selected=await collectKeywordMetrics(db,admin,{keywordIds:[words[0].id,words[1].id]},{searchAd:ads(),search:null,fetchImpl:fetcher},NOW+1);
 assert.equal(selected.measured.length,2);assert.equal(selected.documents,'kept');
 assert.equal(selected.measured.find(m=>m.phrase==='제주 여행')!.documentCount,6400,'keeps last known count without naver search');
 await assert.rejects(collectKeywordMetrics(db,admin,{keywordIds:[randomUUIDLike()]},{searchAd:ads(),fetchImpl:fetcher},NOW),{status:404,code:'KEYWORD_NOT_FOUND'});
 const authFail:FetchLike=(async()=>json({title:'bad'},403)) as FetchLike;
 const r2=await collectKeywordMetrics(db,admin,{},{searchAd:ads(),search:null,fetchImpl:authFail},NOW+2);
 assert.equal(r2.measured.length,0);assert.equal(r2.failed.length,6,'remaining batches marked failed after terminal error');
 assert.equal(r2.failed[0].code,'SEARCHAD_AUTH');
});
const randomUUIDLike=()=>crypto.randomUUID();

test('exposure rows are pruned to the latest 50 per member and removed with the account',async t=>{
 const {db,a,b}=await fixture(t);
 for(let i=0;i<55;i++)db.prepare("INSERT INTO keyword_exposures(id,owner_id,keyword,total,results_json,checked_at,created_at) VALUES(?,?,?,1,'[]',?,?)").run(crypto.randomUUID(),a,`k${i}`,NOW-i,NOW-i);
 await checkExposure(db,b,{keyword:'b'},{config:nv(),fetchImpl:(async()=>blogList([],1)) as FetchLike},NOW);
 const pruned=runRetention(db,NOW);
 assert.equal(pruned.exposures,5,'keeps newest 50 per member');
 assert.equal(listExposures(db,a).length,50);assert.equal(listExposures(db,b).length,1);
 db.prepare('DELETE FROM users WHERE id=?').run(a);
 assert.equal((db.prepare('SELECT count(*) AS n FROM keyword_exposures WHERE owner_id=?').get(a) as {n:number}).n,0,'account deletion cascades');
});
