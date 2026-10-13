import {randomUUID} from 'node:crypto';
import {transaction,type Database} from '../database';

const EVENTS_SEED='events-v1';
/**
 * 원본 사이트의 이벤트 주소(/event/ranking-reward, /event/naeo-review)를 유지하려고 두 이벤트를 한 번만 넣는다.
 * 문구는 이 복제본에서 새로 쓴 안내이며, 실제 운영 전에 운영자가 경품·기간을 확정해 고쳐야 한다.
 */
const EVENTS=[{
 slug:'ranking-reward',title:'주간 랭킹 리워드',status:'published',startsAt:'2026-01-05T00:00:00+09:00',endsAt:'2028-01-01T00:00:00+09:00',
 summary:'랭킹 공개를 켜고 블로그를 진단하면 매주 확정 순위 상위 회원에게 토큰을 드려요.',
 body:'## 참여 방법\n\n1. 설정에서 **랭킹 공개**를 켭니다.\n2. 대시보드에서 대표 블로그를 진단합니다.\n3. 매주 월요일 0시(한국 시간)에 지난주 순위가 확정되면, 운영자가 상위 회원에게 토큰 리워드를 지급합니다.\n\n## 안내\n\n- 리워드는 대시보드 > 이벤트에서 확인할 수 있습니다.\n- 지급 인원·토큰 수는 운영 공지에 따릅니다.',
 requiresProof:0,rewardTokens:0,acceptsEntries:0,ctaLabel:'블로그 등록하고 참여하기',ctaHref:'/login?next=/dashboard',
},{
 slug:'naeo-review',title:'사용 후기 이벤트',status:'closed',startsAt:'2026-09-01T00:00:00+09:00',endsAt:'2026-10-01T00:00:00+09:00',
 summary:'NAEO를 써 본 후기를 내 네이버 블로그에 올리고 글 주소로 참여하는 이벤트예요.',
 body:'## 참여 방법\n\n1. 설정에서 내 네이버 블로그를 등록합니다.\n2. NAEO 사용 후기를 블로그 글로 올립니다.\n3. 이 화면에서 글 주소를 제출합니다.\n\n## 심사와 리워드\n\n- 운영자가 글을 확인해 승인하면 토큰이 지급됩니다.\n- 한 회원당 한 번 참여할 수 있으며, 심사 전에는 고치거나 철회할 수 있습니다.',
 requiresProof:1,rewardTokens:30,acceptsEntries:1,ctaLabel:'',ctaHref:'',
}];

export function seedEvents(db:Database,now:number):void{
 transaction(db,()=>{
  if(db.prepare('SELECT 1 FROM seed_runs WHERE name=?').get(EVENTS_SEED))return;
  const insert=db.prepare(`INSERT INTO events(id,slug,title,summary,body,status,starts_at,ends_at,requires_proof,reward_tokens,accepts_entries,cta_label,cta_href,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO NOTHING`);
  for(const e of EVENTS)insert.run(randomUUID(),e.slug,e.title,e.summary,e.body,e.status,Date.parse(e.startsAt),Date.parse(e.endsAt),e.requiresProof,e.rewardTokens,e.acceptsEntries,e.ctaLabel,e.ctaHref,now,now);
  db.prepare('INSERT INTO seed_runs(name,applied_at) VALUES(?,?)').run(EVENTS_SEED,now);
 });
}
