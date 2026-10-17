import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {openDatabase} from '../../src/server/database';
import {createApi} from '../../src/server/api';
import type {MateReport} from '../../src/server/mate/mate';

test('home analysis HTTP flow collects public RSS, shares evidence, and distinguishes empty/missing/unavailable feeds',async t=>{
 const requests:string[]=[];
 const server=createServer((req,res)=>{
  requests.push(req.url!);
  if(req.url==='/missing_blog.xml'){res.writeHead(404).end();return;}
  if(req.url==='/unavailable_blog.xml'){res.writeHead(503).end();return;}
  res.setHeader('Content-Type','application/rss+xml');
  res.end(`<rss><channel><title>실제 수집 계약 테스트</title>${req.url==='/empty_blog.xml'?'':`<item><title>&lt;안전한 제목&gt; 데이터 분석 가이드</title><link>https://blog.naver.com/qa_blog/224000000000</link><category>테크</category><tag>데이터,분석,테크</tag><pubDate>${new Date().toUTCString()}</pubDate></item><item><title>외부 링크</title><link>https://evil.example/123</link></item>`}</channel></rss>`);
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const addr=server.address();assert.ok(addr&&typeof addr==='object');
 const prior=process.env.NAEO_RSS_BASE,priorOrigin=process.env.NAEO_APP_URL;
 process.env.NAEO_RSS_BASE=`http://127.0.0.1:${addr.port}`;
 const origin='http://127.0.0.1:3000';process.env.NAEO_APP_URL=origin;
 const db=openDatabase(':memory:');
 t.after(async()=>{
  db.close();
  if(prior===undefined)delete process.env.NAEO_RSS_BASE;else process.env.NAEO_RSS_BASE=prior;
  if(priorOrigin===undefined)delete process.env.NAEO_APP_URL;else process.env.NAEO_APP_URL=priorOrigin;
  await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 });
 const handler=createApi(()=>db);
 const diagnose=(blog:string)=>handler(new Request(`${origin}/api/mate/diagnose`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({blog})}));
 const response=await diagnose('https://m.blog.naver.com/PostView.naver?blogId=QA_BLOG&logNo=224000000000');
 assert.equal(response.status,201);
 const {data}=await response.json() as {data:MateReport};
 assert.equal(data.saved,false);assert.equal(data.postCount,1);
 assert.equal(data.source?.posts[0].title,'<안전한 제목> 데이터 분석 가이드');
 assert.equal(data.source?.posts[0].url,'https://blog.naver.com/qa_blog/224000000000');
 assert.deepEqual(requests,['/qa_blog.xml']);
 const shared=await handler(new Request(`${origin}/api/mate/reports/${data.token}`));
 assert.equal(shared.status,200);
 const sharedData=(await shared.json()).data;
 assert.deepEqual(sharedData.source,data.source);
 assert.equal('ownerId' in sharedData,false);
 assert.equal((await handler(new Request(`${origin}/api/mate/reports`))).status,401);
 for(const [blog,status,code] of [['empty_blog',422,'NO_PUBLIC_POSTS'],['missing_blog',404,'BLOG_NOT_FOUND'],['unavailable_blog',502,'FETCH_FAILED']] as const){
  const failed=await diagnose(blog);assert.equal(failed.status,status);assert.equal((await failed.json()).error.code,code);
 }
 const invalid=await diagnose('https://evil.example/qa_blog');assert.equal(invalid.status,400);
 assert.equal(requests.length,4,'invalid inputs never request an external address');
 assert.equal((db.prepare('SELECT count(*) AS n FROM mate_reports').get() as {n:number}).n,1,'failed collection never saves a score');
});
