/** 로컬 수동 QA용 SerpApi double. 사용법: node scripts/qa/serpapi-stub.mjs <port>
 * 모든 query에 naver 통합검색 + AI 브리핑을 응답한다. 출처는 qa_cite 블로그 글 101~104와 외부 출처를 섞는다. */
import {createServer} from 'node:http';
const port=Number(process.argv[2]||3101);
createServer((q,r)=>{
 const u=new URL(q.url,'http://local');
 if(u.pathname!=='/search.json'||!u.searchParams.get('api_key')){r.writeHead(401);return r.end('{"error":"Invalid API key."}');}
 const engine=u.searchParams.get('engine'),query=u.searchParams.get('query')??'';r.writeHead(200,{'Content-Type':'application/json'});
 if(engine==='naver')return r.end(JSON.stringify({
  blog_results:[{link:'https://blog.naver.com/qa_cite/101'},{link:'https://blog.naver.com/someone/5'}],
  ai_briefing:query.includes('부산')?{markdown:'부산 요약 [1]',references:[{index:1,title:'다른 블로그',link:'https://blog.naver.com/someone/5'}]}:{page_token:'stub_token'}}));
 r.end(JSON.stringify({markdown:`"${query}"에 대한 AI 브리핑입니다. [1][2][3]`,references:[{index:1,title:'외부 백과',link:'https://example.com/wiki'},{index:2,title:'내 글이 인용됨',link:'https://blog.naver.com/qa_cite/101'},{index:3,title:'경쟁 글',link:'https://blog.naver.com/rival/9'}],
  media:[{position:1,title:'내 사진',link:'https://blog.naver.com/PostView.naver?blogId=qa_cite&logNo=102',thumbnail:'https://example.com/t.jpg',platform:'네이버 블로그'},{position:4,title:'남의 사진',link:'https://blog.naver.com/rival/9'}],related_questions:[{question:'비용은 얼마나 드나요?'},{question:'초보자 팁은?'}]}));
}).listen(port,'127.0.0.1',()=>console.log(`serpapi stub on ${port}`));
