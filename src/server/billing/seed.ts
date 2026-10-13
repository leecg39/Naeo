import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';
import {getCapturedPage} from '../../lib/pages';
import type {CapturedNode} from '../../types/site';
import {findAll,textOf} from '../content/tree';

const PLANS_SEED='plans-v1';
/**
 * 캡처한 /pricing의 가격 카드에서 이름·가격·월 토큰을 읽어 요금제를 한 번만 만든다(가격이 숫자가 아닌 '문의' 카드는 제외).
 * 체험 일수는 작업 계획(7일 체험)에 따라 유료 요금제에 7일. 실제 운영 전 관리자가 가격·혜택을 확정해야 한다.
 */
export async function seedPlans(db:Database,now=Date.now()):Promise<void>{
 if(db.prepare('SELECT 1 FROM seed_runs WHERE name=?').get(PLANS_SEED))return;
 const page=await getCapturedPage('/pricing');
 const cards=page?findAll(page.body as CapturedNode[],n=>(n.attrs.class??'').includes('MuiCard-root')):[];
 const plans=cards.map((card,i)=>{
  const name=textOf(findAll([card],n=>n.tag==='h6')[0]??'').trim();
  const price=textOf(findAll([card],n=>n.tag==='h4')[0]??'');
  const tokens=Number((textOf(card).match(/([\d,]+)\s*토큰/)?.[1]??'0').replace(/,/g,''));
  return/\d/.test(price)&&name?{name,price:Number(price.replace(/[^\d]/g,'')),tokens,position:i}:null;
 }).filter((p):p is {name:string;price:number;tokens:number;position:number}=>p!==null);
 transaction(db,()=>{
  if(db.prepare('SELECT 1 FROM seed_runs WHERE name=?').get(PLANS_SEED))return;
  const insert=db.prepare('INSERT INTO plans(id,code,name,description,price_krw,monthly_tokens,trial_days,status,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(code) DO NOTHING');
  for(const p of plans){
   const code=p.price===0?'free':p.position===1?'basic':`plan-${p.position}`;
   insert.run(randomUUID(),code,p.name,p.price===0?'블로그 진단을 무료로 시작해요.':'AI 글쓰기와 분석을 넉넉하게 쓰는 30일 이용권이에요.',p.price,p.tokens,p.price>0?7:0,'active',p.position,now,now);
  }
  db.prepare('INSERT INTO seed_runs(name,applied_at) VALUES(?,?)').run(PLANS_SEED,now);
 });
}
