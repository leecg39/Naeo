import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../../src/server/database';
import {register} from '../../src/server/auth';
import {createProject,getProject,listProjects,updateProject,deleteProject,duplicateProject,addSlide,updateSlide,deleteSlide,moveSlide,duplicateSlide,PROJECT_LIMIT,SLIDE_LIMIT} from '../../src/server/creative/projects';
import {slideSvg} from '../../src/server/creative/svg';

async function fixture(t:TestContext){
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const mk=async(e:string)=>(await register(db,{email:e,password:'creative-long-password',nickname:e[0],termsAccepted:true})).user.id;
 return{db,a:await mk('a@example.test'),b:await mk('b@example.test')};
}
const order=(db:ReturnType<typeof openDatabase>,a:string,id:string)=>getProject(db,a,id).slides.map(s=>s.heading);

test('projects: presets by kind, owner-only access, versions, limits',async t=>{
 const {db,a,b}=await fixture(t);
 const p=createProject(db,a,{kind:'carousel',title:'AEO 캐러셀'});
 assert.deepEqual([p.width,p.height,p.slides.length],[1080,1440,1],'starts with one cover slide');
 assert.deepEqual([createProject(db,a,{kind:'ad',title:'광고'}).height,createProject(db,a,{kind:'video',title:'영상'}).width],[1350,1920]);
 assert.throws(()=>getProject(db,b,p.id),{status:404},'other members cannot see it');
 assert.throws(()=>createProject(db,a,{kind:'poster',title:'x'}),{name:'ZodError'});
 const renamed=updateProject(db,a,p.id,{title:'새 제목',theme:{background:'#111111',accent:'#03c75a',text:'#ffffff'},version:1});
 assert.equal(renamed.version,2);
 assert.throws(()=>updateProject(db,a,p.id,{title:'x',version:1}),{status:409,code:'VERSION_CONFLICT'});
 assert.throws(()=>updateProject(db,a,p.id,{theme:{background:'red',accent:'#000000',text:'#ffffff'},version:2}),{name:'ZodError'});
 assert.equal(listProjects(db,a).length,3);assert.equal(listProjects(db,b).length,0);
 for(let i=listProjects(db,a).length;i<PROJECT_LIMIT;i++)createProject(db,a,{kind:'carousel',title:`p${i}`});
 assert.throws(()=>createProject(db,a,{kind:'carousel',title:'over'}),{status:409,code:'PROJECT_LIMIT'});
 deleteProject(db,a,p.id,{version:2});
 assert.throws(()=>getProject(db,a,p.id),{status:404});
});

test('slides: add at position, edit, reorder, duplicate, delete keep positions contiguous',async t=>{
 const {db,a,b}=await fixture(t);
 const p=createProject(db,a,{kind:'carousel',title:'정렬'});
 updateSlide(db,a,p.id,p.slides[0].id,{heading:'A',version:1});
 const sB=addSlide(db,a,p.id,{heading:'B'});addSlide(db,a,p.id,{heading:'C'});
 addSlide(db,a,p.id,{heading:'첫째',position:0});
 assert.deepEqual(order(db,a,p.id),['첫째','A','B','C']);
 moveSlide(db,a,p.id,sB.id,{position:0});
 assert.deepEqual(order(db,a,p.id),['B','첫째','A','C']);
 moveSlide(db,a,p.id,sB.id,{position:3});
 assert.deepEqual(order(db,a,p.id),['첫째','A','C','B']);
 const copy=duplicateSlide(db,a,p.id,sB.id);
 assert.equal(copy.heading,'B');assert.deepEqual(order(db,a,p.id),['첫째','A','C','B','B']);
 deleteSlide(db,a,p.id,copy.id);
 assert.deepEqual(getProject(db,a,p.id).slides.map(s=>s.position),[0,1,2,3]);
 assert.throws(()=>updateSlide(db,b,p.id,sB.id,{heading:'x',version:1}),{status:404});
 assert.throws(()=>updateSlide(db,a,p.id,sB.id,{background:'blue',version:1}),{name:'ZodError'});
 const dup=duplicateProject(db,a,p.id);
 assert.equal(dup.title,'정렬 (복사본)');assert.deepEqual(dup.slides.map(s=>s.heading),['첫째','A','C','B']);
 updateSlide(db,a,dup.id,dup.slides[0].id,{heading:'바뀜',version:1});
 assert.equal(order(db,a,p.id)[0],'첫째','copies are independent');
 for(let i=getProject(db,a,p.id).slides.length;i<SLIDE_LIMIT;i++)addSlide(db,a,p.id,{heading:`s${i}`});
 assert.throws(()=>addSlide(db,a,p.id,{heading:'over'}),{status:409,code:'SLIDE_LIMIT'});
 const one=createProject(db,a,{kind:'ad',title:'한 장'});
 assert.throws(()=>deleteSlide(db,a,one.id,one.slides[0].id),{status:409,code:'LAST_SLIDE'});
});

test('svg rendering escapes text, wraps long Korean lines and uses the project size',async t=>{
 const {db,a}=await fixture(t);
 const p=createProject(db,a,{kind:'carousel',title:'렌더'});
 const s=updateSlide(db,a,p.id,p.slides[0].id,{heading:'<script>alert(1)</script> & "따옴표"',body:'가'.repeat(120),caption:'@naeo',background:'#202020',version:1});
 const svg=slideSvg(getProject(db,a,p.id),s,0,1);
 assert.match(svg,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1080" height="1440" viewBox="0 0 1080 1440"/);
 assert.ok(!svg.includes('<script'),'markup in text is escaped');
 for(const piece of ['&lt;script&gt;','&lt;/script','&amp;','&quot;따옴표&quot;'])assert.ok(svg.includes(piece),piece);
 assert.ok((svg.match(/<tspan /g)??[]).length>=5,'long body wraps into several lines');
 assert.match(svg,/fill="#202020"/);assert.match(svg,/1 \/ 1/);
});
