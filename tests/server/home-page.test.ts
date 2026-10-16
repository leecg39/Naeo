import {test} from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {getCapturedPage} from '../../src/lib/pages';
import {buildHomePage,HOME_DEMO_STAGES} from '../../src/components/home/home-page';
import {findAll,hasClass,textOf} from '../../src/server/content/tree';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createBlog} from '../../src/server/blogs';
import {saveScanResult} from '../../src/server/analysis/results';
import {analyzePosts} from '../../src/server/analysis/rules';
import {liveRanking} from '../../src/server/ranking/ranking';

const captured=()=>getCapturedPage('/').then(page=>{assert.ok(page);return page;});

test('home resolves captured ranking spinner and count to the actual empty state',async()=>{
 const template=await captured(),before=JSON.stringify(template);
 const page=buildHomePage(template,{data:[],participants:0});
 const section=findAll(page.body,n=>'data-naeo-home-ranking-section' in n.attrs);
 assert.equal(section.length,1);
 assert.equal(findAll(section,n=>n.attrs.role==='progressbar').length,0);
 assert.match(textOf(section[0]),/첫 번째 공개 랭킹을 기다리고/);
 assert.match(textOf(section[0]),/현재 0개 블로그/);
 assert.doesNotMatch(textOf(section[0]),/15,213|TOP 3/);
 assert.equal(JSON.stringify(template),before,'captured data remains unchanged');
});

test('home renders only public ranking participants, escapes content as nodes and keeps real scores',async t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());
 for(const [id,nickname,publicRank,score] of [['public','<공개 블로거>',1,72],['private','숨긴 회원',0,99]] as const){
  const user=(await register(db,{email:`${id}@example.test`,password:'home-long-password',nickname,termsAccepted:true})).user;
  db.prepare('UPDATE profiles SET ranking_public=? WHERE user_id=?').run(publicRank,user.id);
  const blog=createBlog(db,user.id,{naverId:`${id}blog`,title:nickname,category:'여행',isPrimary:true});
  const now=Date.now();
  db.prepare("INSERT INTO scan_jobs(id,owner_id,blog_id,state,run_after,created_at,updated_at,completed_at) VALUES(?,?,?,'succeeded',?,?,?,?)").run(`home-${id}`,user.id,blog.id,now,now,now,now);
  saveScanResult(db,{ownerId:user.id,blogId:blog.id,jobId:`home-${id}`,report:{...analyzePosts([],now),score},postCount:10,measuredAt:now});
 }
 const page=buildHomePage(await captured(),liveRanking(db,{period:'all',pageSize:10},null));
 const section=findAll(page.body,n=>'data-naeo-home-ranking-section' in n.attrs);
 assert.match(textOf(section[0]),/<공개 블로거>/);
 assert.match(textOf(section[0]),/72점/);
 assert.doesNotMatch(textOf(section[0]),/숨긴 회원|99점/);
 assert.equal(findAll(section,n=>n.tag==='a'&&n.attrs.href==='https://blog.naver.com/publicblog').length,1);
 assert.equal(findAll(section,n=>n.tag==='공개 블로거').length,0);
});

test('home exposes each captured writing example through one selected stage and keeps its local images',async()=>{
 const template=await captured(),page=buildHomePage(template,{data:[],participants:0});
 const panels=findAll(page.body,n=>'data-naeo-demo-panel' in n.attrs);
 assert.equal(panels.length,HOME_DEMO_STAGES.length);
 assert.equal(panels.filter(n=>n.attrs['aria-hidden']==='false').length,1);
 const controls=findAll(page.body,n=>'data-naeo-demo-select' in n.attrs);
 assert.equal(controls.length,panels.length);
 for(const control of controls)assert.ok(panels.some(panel=>panel.attrs.id===control.attrs['aria-controls']));
 for(const panel of panels)assert.equal(findAll(panel.children,n=>/(?:^|;)opacity:0(?:;|$)/.test(n.attrs.style??'')).length,0);
 assert.match(textOf(panels[0]),/카드 사용처를 바꿔가며 세 번/);
 assert.ok(findAll(panels[2].children,n=>n.tag==='img').length>0);
 assert.ok(findAll(panels[3].children,n=>n.tag==='img').length>0);
 const images=findAll(page.body,n=>n.tag==='img');
 assert.equal(images.length,findAll(template.body,n=>n.tag==='img').length);
 for(const image of images)await access(`public${image.attrs.src}`);
 assert.equal(findAll(page.body,n=>n.tag==='section').length,findAll(template.body,n=>n.tag==='section').length);
 assert.equal(findAll(page.body,hasClass('mui-5o8f48')).length,1);
});
