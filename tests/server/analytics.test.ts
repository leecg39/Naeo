import {migrations} from '../../src/server/migrations';
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {recordView,recordDwell,shouldTrack,normalizePath,rollupAnalytics,analyticsSummary,RAW_RETENTION_DAYS} from '../../src/server/ops/analytics';
import {runRetention} from '../../src/server/ops/retention';
import {serviceHealth} from '../../src/server/ops/health';

const NOW=Date.parse('2026-10-14T03:00:00Z'),DAY=86_400_000;
async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const admin=(await register(db,{email:'admin@example.test',password:'analytics-long-password',nickname:'관리자',termsAccepted:true})).user.id;
 db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin);
 const member=(await register(db,{email:'m@example.test',password:'analytics-long-password',nickname:'M',termsAccepted:true})).user.id;
 return{db,admin,member};
}
const ua='Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/141 Safari/537.36';

test('tracking rules: privacy signals, bots, admin/API paths; paths are normalized',()=>{
 assert.equal(shouldTrack({path:'/ranking',userAgent:ua,dnt:null,gpc:null}),true);
 assert.equal(shouldTrack({path:'/ranking',userAgent:ua,dnt:'1',gpc:null}),false,'Do Not Track');
 assert.equal(shouldTrack({path:'/ranking',userAgent:ua,dnt:null,gpc:'1'}),false,'Global Privacy Control');
 assert.equal(shouldTrack({path:'/ranking',userAgent:'Googlebot/2.1',dnt:null,gpc:null}),false);
 assert.equal(shouldTrack({path:'/admin/users',userAgent:ua,dnt:null,gpc:null}),false);
 assert.equal(normalizePath('/blog/guide/x?utm_source=a#top'),'/blog/guide/x');
 assert.equal(normalizePath('/event/naeo-review/'),'/event/naeo-review');
 assert.equal(normalizePath('/p/AbCdEfGhIjKlMnOpQrStUv/images'),'/p/:token/images','share tokens are not stored');
 assert.equal(normalizePath('/dashboard/events/my-slug'),'/dashboard/events/my-slug');
 assert.equal(normalizePath('javascript:alert(1)'),null);
});

test('views and dwell: no IP, daily salted visitor hashes, referrer host only; rollup and summary',async t=>{
 const {db,admin,member}=await fixture(t);
 const v1=recordView(db,{path:'/ranking',visitorId:'visitor-a-random-0001',referrer:'https://search.naver.com/search.naver?query=naeo'},NOW);
 recordView(db,{path:'/ranking?x=1',visitorId:'visitor-a-random-0001',referrer:''},NOW+1000);
 recordView(db,{path:'/ranking',visitorId:'visitor-b-random-0002',referrer:'http://127.0.0.1:3000/'},NOW+2000,'http://127.0.0.1:3000');
 recordDwell(db,{viewId:v1.id,ms:42_000},NOW+42_000);
 assert.throws(()=>recordDwell(db,{viewId:v1.id,ms:5000},NOW+50_000),{status:409,code:'DWELL_RECORDED'},'one dwell sample per view');
 const raw=db.prepare('SELECT * FROM page_views').all() as Record<string,unknown>[];
 assert.ok(raw.every(r=>!JSON.stringify(r).includes('visitor-a')),'raw visitor ids are never stored');
 assert.deepEqual(raw.map(r=>r.referrer_host).sort(),['','','search.naver.com'],'own-site referrers and full URLs are not kept');
 recordView(db,{path:'/event',visitorId:'visitor-a-random-0001',referrer:''},NOW+3000);
 const tomorrow=recordView(db,{path:'/ranking',visitorId:'visitor-a-random-0001',referrer:''},NOW+DAY);
 assert.notEqual(tomorrow.visitorHash,v1.visitorHash,'the same visitor is not linkable across days');
 rollupAnalytics(db,NOW+DAY+1000);
 const s=analyticsSummary(db,admin,{days:7},NOW+DAY+1000);
 const today=s.daily.find(d=>d.day==='2026-10-14')!;
 assert.deepEqual([today.views,today.visitors],[4,2],'daily visitors are distinct across pages, not a per-page sum');
 assert.equal(s.topPaths[0].path,'/ranking');assert.ok(s.topPaths.every(p=>p.path.startsWith('/')),'daily total rows are not listed as pages');assert.equal(s.topPaths[0].avgDwellSec,42);
 assert.deepEqual(s.referrers.map(r=>r.host),['search.naver.com']);
 assert.throws(()=>analyticsSummary(db,member,{days:7},NOW),{status:403});
 rollupAnalytics(db,NOW+DAY+2000);
 assert.equal(analyticsSummary(db,admin,{days:7},NOW+DAY+2000).daily.find(d=>d.day==='2026-10-14')!.views,4,'rollup is idempotent');
});

test('retention policy and service health',async t=>{
 const {db,admin,member}=await fixture(t);
 recordView(db,{path:'/',visitorId:'visitor-old-000000001',referrer:''},NOW-(RAW_RETENTION_DAYS+1)*DAY);
 db.prepare("INSERT INTO audit_logs VALUES('old-audit',NULL,'x','x','x','{}',?)").run(NOW-400*DAY);
 db.prepare("INSERT INTO audit_logs VALUES('new-audit',NULL,'x','x','x','{}',?)").run(NOW-10*DAY);
 const r=runRetention(db,NOW);
 assert.ok(r.pageViews>=1);assert.equal(r.auditLogs,1);
 assert.equal((db.prepare('SELECT count(*) AS n FROM page_views').get() as {n:number}).n,0);
 assert.equal((db.prepare("SELECT count(*) AS n FROM page_stats WHERE day<='2026-09-13'").get() as {n:number}).n>=1,true,'raw rows are rolled up before deletion');
 assert.equal((db.prepare("SELECT count(*) AS n FROM audit_logs WHERE id IN ('old-audit','new-audit')").get() as {n:number}).n,1);
 db.prepare("INSERT INTO worker_heartbeats(worker_id,started_at,last_seen_at) VALUES('w1',?,?)").run(NOW-DAY,NOW-30_000);
 const h=serviceHealth(db,admin,NOW);
 assert.equal(h.workers[0].alive,true);assert.equal(h.schemaVersion,migrations.at(-1)!.version);
 assert.equal(typeof h.queues.scan.queued,'number');
 assert.equal(h.integrations.payments,false);
 assert.equal(serviceHealth(db,admin,NOW+10*60_000).workers[0].alive,false,'stale heartbeat');
 runRetention(db,NOW+2*DAY);
 assert.equal((db.prepare('SELECT count(*) AS n FROM worker_heartbeats').get() as {n:number}).n,0,'heartbeats of long-gone workers are pruned');
 assert.throws(()=>serviceHealth(db,member,NOW),{status:403});
});
