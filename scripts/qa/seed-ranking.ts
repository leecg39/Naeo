/** Seed the QA database with ranking data (members, scans, titles, mate,
 * metrics) so /ranking renders podium/riser/hall-of-fame for visual checks.
 * Uses the app's own domain functions — same constraints as production.
 * Usage: NAEO_DATABASE_PATH=/tmp/naeo-qa/naeo.sqlite node --import tsx scripts/qa/seed-ranking.ts
 */
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {saveScanResult} from '../../src/server/analysis/results';
import {analyzePosts} from '../../src/server/analysis/rules';
import {confirmPeriod,periodRange} from '../../src/server/ranking/ranking';

const DAY=86_400_000,NOW=Date.now();
const db=openDatabase(process.env.NAEO_DATABASE_PATH??'var/naeo.sqlite');
const seed=async(email:string,nickname:string,category:string,publicRank=1)=>{
 let u;try{u=(await register(db,{email,password:'qa-ranking-password',nickname,termsAccepted:true})).user;}
 catch{u=db.prepare('SELECT id FROM users WHERE email=?').get(email) as {id:string};}
 db.prepare('UPDATE profiles SET ranking_public=? WHERE user_id=?').run(publicRank,u.id);
 const nid=email.split('@')[0];
 const existing=db.prepare('SELECT id FROM blogs WHERE owner_id=? AND naver_id=?').get(u.id,nid) as {id:string}|undefined;
 const blog=existing??createBlog(db,u.id,{naverId:nid,title:`${nickname} 블로그`,category,isPrimary:true});
 return{id:u.id,blog:blog.id};
};
const scored=(m:{id:string;blog:string},score:number,at:number)=>{
 const jid=`seed-${m.id.slice(0,8)}-${at}`;
 if(db.prepare('SELECT 1 FROM scan_jobs WHERE id=?').get(jid))return;
 db.prepare("INSERT INTO scan_jobs(id,owner_id,blog_id,state,run_after,created_at,updated_at,completed_at) VALUES(?,?,?,'succeeded',?,?,?,?)").run(jid,m.id,m.blog,at,at,at,at);
 saveScanResult(db,{ownerId:m.id,blogId:m.blog,jobId:jid,report:{...analyzePosts([],at),score},postCount:10,measuredAt:at});
};

async function main(){
const a=await seed('alpha@qa.test','랭커A','여행');
const b=await seed('bravo@qa.test','랭커B','맛집');
const c=await seed('charlie@qa.test','랭커C','IT·테크');
const w1=periodRange('week',-1,NOW),m1=periodRange('month',-1,NOW);
// last week: B wins (title for podium/badge)
scored(b,88,w1.start+DAY);scored(a,70,w1.start+2*DAY);scored(c,61,w1.start+3*DAY);
// last month: A wins overall; B wins its category
scored(a,92,m1.start+DAY);scored(b,80,m1.start+2*DAY);scored(c,55,m1.start+3*DAY);
// this week: A climbs to 1 (riser = A, 2계단)
scored(a,90,NOW-2*DAY);scored(b,72,NOW-DAY);scored(c,60,NOW-DAY);
// mate report for A + metrics (citation/keyword exposure)
if(!db.prepare("SELECT 1 FROM mate_reports WHERE owner_id=?").get(a.id))
 db.prepare("INSERT INTO mate_reports(token,owner_id,naver_id,score,report_json,post_count,created_at,expires_at) VALUES(?,?,?,72,'{}',12,?,?)").run(`seedmate-${a.id.slice(0,13)}`,a.id,'alpha',NOW-DAY,NOW+30*DAY);
const cited=(m:{id:string;blog:string},at:number,briefing:number,exposed:number,imageRank:number|null)=>{
 const u=`${m.id.slice(0,8)}-${at}`;
 if(db.prepare('SELECT 1 FROM citation_results WHERE id=?').get(`res-${u}`))return;
 db.prepare("INSERT INTO blog_posts(id,blog_id,external_id,url,title,collected_at) VALUES(?,?,?,?,?,?)").run(`post-${u}`,m.blog,`p${at}`,`https://blog.naver.com/x/${at}`,'글',at);
 db.prepare("INSERT INTO citation_runs(id,owner_id,blog_id,state,source,provider,post_limit,run_after,created_at,updated_at) VALUES(?,?,?,'succeeded','scan','seed',1,?,?,?)").run(`run-${u}`,m.id,m.blog,at,at,at);
 db.prepare("INSERT INTO citation_results(id,run_id,owner_id,blog_id,post_id,keyword,keyword_source,status,briefing,exposed,image_rank,evidence_json,checked_at) VALUES(?,?,?,?,?,?,'title','checked',?,?,?,'{}',?)")
  .run(`res-${u}`,`run-${u}`,m.id,m.blog,`post-${u}`,'제주 맛집',briefing,exposed,imageRank,at);
};
const ke=`ke-${a.id.slice(0,8)}`;
if(!db.prepare('SELECT 1 FROM keyword_exposures WHERE id=?').get(ke))
 db.prepare("INSERT INTO keyword_exposures(id,owner_id,keyword,total,results_json,checked_at,created_at) VALUES(?,?,?,?,?,?,?)")
  .run(ke,a.id,'제주 맛집',10,JSON.stringify([{rank:1,naverId:'alpha',title:'t',link:'l',postDate:'',kind:'mine'},{rank:4,naverId:'alpha',title:'t2',link:'l',postDate:'',kind:'mine'}]),NOW-DAY,NOW-DAY);
cited(a,NOW-DAY,1,1,3);cited(a,NOW-2*DAY,0,1,null);cited(b,NOW-DAY,0,1,null);
confirmPeriod(db,'week',-1,NOW);confirmPeriod(db,'month',-1,NOW);
console.log('seeded: 랭커A/B/C, prev-week+prev-month snapshots confirmed, mate+metrics on A');
db.close();
}void main();
