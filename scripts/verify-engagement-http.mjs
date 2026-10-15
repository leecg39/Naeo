import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';

const origin=process.env.NAEO_QA_URL||'http://127.0.0.1:3110';
assert.equal(new URL(origin).hostname,'127.0.0.1','Use the isolated loopback QA server only.');
const password=randomBytes(24).toString('base64url'),email=`points-${Date.now()}@example.test`;
let cookie='';const checks=[];
async function call(path,method='GET',body){
 const response=await fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 return{response,payload:await response.json()};
}
function check(label,actual,expected){assert.deepEqual(actual,expected,label);checks.push({label,result:'passed'});}
try{
 const signup=await call('/api/auth/register','POST',{email,password,nickname:'보상 검증',termsAccepted:true});
 check('register',signup.response.status,201);cookie=signup.response.headers.get('set-cookie').split(';')[0];
 check('initial balance',(await call('/api/points')).payload.data.balance,0);
 check('missing blog locks reward',(await call('/api/tutorial/finish','POST',{step:'blog'})).response.status,409);
 const attendance=await Promise.all(Array.from({length:8},()=>call('/api/attendance','POST')));
 check('8 concurrent check-ins grant once',attendance.reduce((sum,r)=>sum+r.payload.data.awarded,0),5);
 check('blog registered',(await call('/api/blogs','POST',{naverId:`qa_${Date.now()}`,title:'보상 검증 블로그'})).response.status,201);
 check('blog reward',(await call('/api/tutorial/finish','POST',{step:'blog'})).payload.data.awarded,30);
 check('duplicate reward',(await call('/api/tutorial/finish','POST',{step:'blog'})).payload.data.awarded,0);
 check('sub-topic saved',(await call('/api/tutorial/sub-topic','PUT',{subTopic:'여행',version:0})).response.status,200);
 check('ranking not visited',(await call('/api/tutorial/finish','POST',{step:'ranking'})).response.status,409);
 check('ranking visit',(await call('/api/tutorial/ranking-visit','POST')).response.status,200);
 check('ranking reward',(await call('/api/tutorial/finish','POST',{step:'ranking'})).payload.data.awarded,90);
 check('unavailable verification remains locked',(await call('/api/tutorial/finish','POST',{step:'verify'})).response.status,409);
 check('sub-topic cooldown',(await call('/api/tutorial/sub-topic','DELETE',{version:1})).response.status,409);
 const wallet=(await call('/api/points')).payload.data;
 check('ledger balance',wallet.balance,125);check('three ledger entries',wallet.entries.length,3);
 for(const path of ['/dashboard','/dashboard/settings']){
  const response=await fetch(origin+path,{headers:{Cookie:cookie}}),html=await response.text();
  check(`${path} HTTP`,response.status,200);check(`${path} reward UI rendered`,html.includes('포인트와 출석'),true);
  check(`${path} no RSC serialization error`,/Only plain objects|E\{.*digest/.test(html),false);
 }
 await call('/api/auth/logout','POST');cookie='';
 const login=await call('/api/auth/login','POST',{email,password});check('login again',login.response.status,200);cookie=login.response.headers.get('set-cookie').split(';')[0];
 check('balance persists across new session',(await call('/api/points')).payload.data.balance,125);
 const profile=(await call('/api/auth/me')).payload.data.user;
 check('withdrawal',(await call('/api/auth/account','DELETE',{currentPassword:password,confirmEmail:email,version:profile.version})).response.status,200);
 check('deleted session denied',(await call('/api/points')).response.status,401);cookie='';
 const result={at:new Date().toISOString(),origin,checks,limitations:['HTTP and server-rendered HTML only; this does not prove browser hydration or visual fidelity.'],testAccountDeleted:true};
 await mkdir('docs/fullstack/evidence',{recursive:true});
 await writeFile('docs/fullstack/evidence/engagement-http.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,status:'passed',testAccountDeleted:true}));
}finally{
 if(cookie){const me=await call('/api/auth/me');if(me.response.ok)await call('/api/auth/account','DELETE',{currentPassword:password,confirmEmail:email,version:me.payload.data.user.version});}
}
