import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {createApi} from '../../src/server/api';

const origin='http://127.0.0.1:3000';
process.env.NAEO_APP_URL=origin;
const UA='Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/141 Safari/537.36';
function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const handler=createApi(()=>db);
 const send=(p:string,method='GET',body?:unknown,headers:Record<string,string>={})=>handler(new Request(origin+p,{method,headers:{Origin:origin,'Content-Type':'application/json','User-Agent':UA,...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}));
 return{db,send};
}

test('analytics API: server-issued visitor cookie, privacy opt-outs, admin-only stats and health',async t=>{
 const f=fixture(t);
 const first=await f.send('/api/analytics/view','POST',{path:'/ranking',referrer:'https://m.search.naver.com/x?q=1'});
 assert.equal(first.status,201);
 const cookie=first.headers.get('set-cookie')!;
 assert.match(cookie,/^naeo_vid=[A-Za-z0-9_-]{24}; Path=\/api\/analytics; HttpOnly; SameSite=Lax/);
 const vid=cookie.split(';')[0];
 const again=await f.send('/api/analytics/view','POST',{path:'/event'},{Cookie:vid});
 assert.equal(again.headers.get('set-cookie'),null,'known visitors keep their cookie');
 const {data}=await again.json();
 assert.equal((await f.send('/api/analytics/dwell','POST',{viewId:data.viewId,ms:15000})).status,204);
 for(const h of [{DNT:'1'},{'Sec-GPC':'1'},{'User-Agent':'Googlebot/2.1'}] as Record<string,string>[])assert.equal((await f.send('/api/analytics/view','POST',{path:'/'},h)).status,204);
 assert.equal((await f.send('/api/analytics/view','POST',{path:'/admin/users'})).status,204);
 assert.equal((await f.send('/api/analytics/view','POST',{path:'/x'},{Origin:'https://evil.example'})).status,403);
 assert.equal((f.db.prepare('SELECT count(*) AS n FROM page_views').get() as {n:number}).n,2);
 const r=await f.send('/api/auth/register','POST',{email:'a@example.test',password:'analytics-http-pass',nickname:'A',termsAccepted:true});
 const admin=r.headers.get('set-cookie')!.split(';')[0];
 assert.equal((await f.send('/api/admin/analytics?days=7','GET',undefined,{Cookie:admin})).status,403);
 f.db.prepare("UPDATE users SET role='admin'").run();
 const stats=(await (await f.send('/api/admin/analytics?days=7','GET',undefined,{Cookie:admin})).json()).data;
 assert.equal(stats.daily.reduce((a:number,d:{views:number})=>a+d.views,0),2);
 assert.deepEqual(stats.referrers.map((x:{host:string})=>x.host),['m.search.naver.com']);
 const health=(await (await f.send('/api/admin/health','GET',undefined,{Cookie:admin})).json()).data;
 assert.equal(health.schemaVersion,25);assert.ok(!JSON.stringify(health).includes('KEY'),'no secrets in health output');
});
