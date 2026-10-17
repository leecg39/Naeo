import http from 'node:http';
const posts=Array.from({length:15},(_,i)=>({title:`테스트 글 ${i+1} — 여행 후기와 팁`,link:`https://blog.naver.com/alpha/${1000+i}`,pub:new Date(Date.now()-i*86400000).toUTCString(),desc:`본문 내용 ${i+1}`.repeat(30)}));
http.createServer((req,res)=>{
 const id=req.url.match(/\/([^/?]+)/)?.[1]||'alpha';
 const items=posts.map(p=>`<item><title>${p.title}</title><link>${p.link}</link><category>여행</category><description>${p.desc}</description><pubDate>${p.pub}</pubDate></item>`).join('');
 res.writeHead(200,{'content-type':'application/rss+xml'});
 res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>${id}</title>${items}</channel></rss>`);
}).listen(4599,'127.0.0.1',()=>console.log('rss stub on 4599'));
