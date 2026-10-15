import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {transaction,type Database} from '../database';
import {requireTerms,userById} from '../auth';
import {AppError} from '../errors';
import {paginationInput} from '../validation';

const DAY=86_400_000,COOLDOWN=7*DAY;
export const POINT_POLICY={version:'local-fixed-v1',timezone:'Asia/Seoul',daily:5,streakEvery:7,streakBonus:15,subTopicCooldownDays:7} as const;
const STEPS=[{key:'blog',title:'블로그 등록',points:30,href:'/dashboard/settings'},
 {key:'mate',title:'메이트 진단',points:30,href:'/dashboard/mate'},
 {key:'ai_picks',title:'AI 인용 현황',points:30,href:'/dashboard/ai-picks'},
 {key:'ranking',title:'랭킹 둘러보기 + 서브 주제',points:90,href:'/ranking'},
 {key:'verify',title:'휴대폰 인증',points:120,href:'/dashboard/settings'}] as const;
const finishInput=z.object({step:z.enum(['blog','mate','ai_picks','ranking','verify'])}).strict();
const topicInput=z.object({subTopic:z.string().trim().min(1).max(50),version:z.number().int().min(0)}).strict();
const versionInput=z.object({version:z.number().int().min(0)}).strict();
const dayOf=(now:number)=>new Date(now+9*60*60*1000).toISOString().slice(0,10);

function assertMember(db:Database,id:string){
 const user=userById(db,id);requireTerms(user);
 if(user.status!=='active')throw new AppError(401,'UNAUTHENTICATED','다시 로그인해주세요.');
}
function pointBalance(db:Database,id:string){
 return(db.prepare('SELECT coalesce(sum(delta),0) balance FROM point_ledger WHERE owner_id=?').get(id) as {balance:number}).balance;
}
function award(db:Database,id:string,delta:number,reason:'attendance'|'tutorial',reference:string,now:number){
 db.prepare('INSERT INTO point_ledger(id,owner_id,delta,reason,reference,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,delta,reason,reference,now);
}
type Attendance={day:string;streak:number;points:number;createdAt:number};
function latestAttendance(db:Database,id:string,now:number){
 return db.prepare('SELECT day,streak,points,created_at AS createdAt FROM attendance WHERE owner_id=? AND day<=? ORDER BY day DESC LIMIT 1').get(id,dayOf(now)) as Attendance|undefined;
}
export function points(db:Database,id:string,query:unknown={},now=Date.now()){
 assertMember(db,id);
 const {page,pageSize}=paginationInput.parse(query),today=dayOf(now),last=latestAttendance(db,id,now);
 const rows=db.prepare('SELECT id,delta,reason,reference,created_at AS createdAt FROM point_ledger WHERE owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?').all(id,pageSize,(page-1)*pageSize) as {id:string;delta:number;reason:string;reference:string;createdAt:number}[];
 const {total}=db.prepare('SELECT count(*) total FROM point_ledger WHERE owner_id=?').get(id) as {total:number};
 return{balance:pointBalance(db,id),entries:rows.map(row=>({...row})),pagination:{page,pageSize,total},policy:POINT_POLICY,
  attendance:{today,checkedIn:last?.day===today,streak:last&&(last.day===today||last.day===dayOf(now-DAY))?last.streak:0,last:last?{...last}:null}};
}
export function checkIn(db:Database,id:string,now=Date.now()){
 return transaction(db,()=>{
  assertMember(db,id);const last=latestAttendance(db,id,now),day=dayOf(now);
  if(last?.day===day)return{...last,alreadyCheckedIn:true,awarded:0,balance:pointBalance(db,id)};
  const streak=last?.day===dayOf(now-DAY)?last.streak+1:1;
  const amount=POINT_POLICY.daily+(streak%POINT_POLICY.streakEvery===0?POINT_POLICY.streakBonus:0);
  db.prepare('INSERT INTO attendance(owner_id,day,streak,points,created_at) VALUES(?,?,?,?,?)').run(id,day,streak,amount,now);
  award(db,id,amount,'attendance',day,now);
  return{day,streak,points:amount,createdAt:now,alreadyCheckedIn:false,awarded:amount,balance:pointBalance(db,id)};
 });
}
export function subTopic(db:Database,id:string){
 assertMember(db,id);
 const row=db.prepare('SELECT sub_topic AS subTopic,version,changed_at AS changedAt FROM engagement_preferences WHERE owner_id=?').get(id) as {subTopic:string;version:number;changedAt:number}|undefined;
 return row?{...row,nextChangeAt:row.changedAt+COOLDOWN}:{subTopic:'',version:0,changedAt:null,nextChangeAt:null};
}
function changeTopic(db:Database,id:string,topic:string,version:number,now:number){
 return transaction(db,()=>{
  assertMember(db,id);
  if(topic&&!db.prepare('SELECT 1 FROM blogs WHERE owner_id=?').get(id))throw new AppError(409,'BLOG_REQUIRED','블로그를 먼저 등록해주세요.');
  const current=subTopic(db,id);
  if(current.version!==version)throw new AppError(409,'VERSION_CONFLICT','서브 주제가 변경되었습니다. 새로고침해주세요.');
  if(current.subTopic===topic)return current;
  if(current.nextChangeAt!==null&&now<current.nextChangeAt)throw new AppError(409,'TOPIC_COOLDOWN','서브 주제는 변경 후 7일이 지나야 수정하거나 삭제할 수 있습니다.');
  db.prepare('INSERT INTO engagement_preferences(owner_id,sub_topic,version,changed_at) VALUES(?,?,1,?) ON CONFLICT(owner_id) DO UPDATE SET sub_topic=excluded.sub_topic,version=engagement_preferences.version+1,changed_at=excluded.changed_at').run(id,topic,now);
  return subTopic(db,id);
 });
}
export function saveSubTopic(db:Database,id:string,input:unknown,now=Date.now()){
 const v=topicInput.parse(input);return changeTopic(db,id,v.subTopic,v.version,now);
}
export function removeSubTopic(db:Database,id:string,input:unknown,now=Date.now()){
 const v=versionInput.parse(input);return changeTopic(db,id,'',v.version,now);
}
export function visitRanking(db:Database,id:string,now=Date.now()){
 assertMember(db,id);
 db.prepare('INSERT INTO engagement_visits(owner_id,ranking_at) VALUES(?,?) ON CONFLICT(owner_id) DO NOTHING').run(id,now);
 return{recorded:true};
}
export function tutorial(db:Database,id:string,now=Date.now()){
 assertMember(db,id);
 const claims=db.prepare('SELECT step,created_at AS createdAt FROM tutorial_claims WHERE owner_id=?').all(id) as {step:string;createdAt:number}[];
 const hasBlog=Boolean(db.prepare('SELECT 1 FROM blogs WHERE owner_id=?').get(id));
 const hasMate=Boolean(db.prepare('SELECT 1 FROM mate_reports s JOIN blogs b ON b.naver_id=s.naver_id WHERE s.owner_id=? AND b.owner_id=? AND s.post_count>0 AND s.expires_at>?').get(id,id,now));
 const prefs=subTopic(db,id),visited=Boolean(db.prepare('SELECT 1 FROM engagement_visits WHERE owner_id=?').get(id));
 const reasons={blog:hasBlog?'':'블로그를 먼저 등록해주세요.',mate:hasMate?'':'본인 블로그의 글이 있는 진단을 완료해주세요.',
  ai_picks:'AI 인용 확인 공급자가 연결되면 수령할 수 있습니다.',
  ranking:!hasBlog?'블로그를 먼저 등록해주세요.':!visited?'랭킹을 먼저 둘러봐주세요.':!prefs.subTopic?'서브 주제를 저장해주세요.':'',
  verify:'휴대폰 인증 보상은 동일 번호 중복 수령 검증이 연결된 뒤 받을 수 있습니다.'};
 const steps=STEPS.map(step=>{const claim=claims.find(c=>c.step===step.key);return{...step,done:Boolean(claim),claimedAt:claim?.createdAt??null,eligible:!claim&&!reasons[step.key],lockedReason:claim?'':reasons[step.key]};});
 return{steps,completedAll:steps.every(s=>s.done),totalPoints:300,claimedPoints:steps.filter(s=>s.done).reduce((n,s)=>n+s.points,0),subTopic:prefs,now};
}
export function finishTutorial(db:Database,id:string,input:unknown,now=Date.now()){
 const {step}=finishInput.parse(input);
 return transaction(db,()=>{
  assertMember(db,id);const state=tutorial(db,id,now),selected=state.steps.find(s=>s.key===step)!;
  if(selected.done)return{awarded:0,alreadyClaimed:true,balance:pointBalance(db,id)};
  if(!selected.eligible)throw new AppError(409,'TUTORIAL_LOCKED',selected.lockedReason);
  db.prepare('INSERT INTO tutorial_claims(owner_id,step,points,created_at) VALUES(?,?,?,?)').run(id,step,selected.points,now);
  award(db,id,selected.points,'tutorial',step,now);
  return{awarded:selected.points,alreadyClaimed:false,balance:pointBalance(db,id)};
 });
}
export type PointsState=ReturnType<typeof points>;
export type TutorialState=ReturnType<typeof tutorial>;
