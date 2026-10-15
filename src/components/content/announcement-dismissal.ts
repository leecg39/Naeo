/** REA 공지 코드: UTC 날짜와 공지 ID를 저장한다. 버전 변경으로 숨김을 해제하지 않는다. */
export const ANNOUNCEMENT_DISMISSAL_KEY='announcement_dismissed';
type StoragePort=Pick<Storage,'getItem'|'setItem'>;
const dateKey=(now:Date)=>now.toISOString().split('T')[0];

function readIds(storage:StoragePort,now:Date):string[]{
 try{
  const value:unknown=JSON.parse(storage.getItem(ANNOUNCEMENT_DISMISSAL_KEY)??'null');
  if(!value||typeof value!=='object')return [];
  const record=value as {date?:unknown;ids?:unknown};
  return record.date===dateKey(now)&&Array.isArray(record.ids)?record.ids.filter((id):id is string=>typeof id==='string'):[];
 }catch{return [];}
}
export function isAnnouncementDismissed(storage:StoragePort,id:string,now=new Date()):boolean{
 return readIds(storage,now).includes(id);
}
/** 저장 실패와 무관하게 호출 화면은 닫을 수 있다. */
export function dismissAnnouncementToday(storage:StoragePort,id:string,now=new Date()):void{
 try{storage.setItem(ANNOUNCEMENT_DISMISSAL_KEY,JSON.stringify({date:dateKey(now),ids:[...new Set([...readIds(storage,now),id])]}));}catch{/* 저장이 차단된 환경 */}
}
