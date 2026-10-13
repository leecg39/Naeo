/**
 * 한국 시간 표기: ICU 버전(서버 Node·브라우저)과 무관하게 같은 글자를 낸다.
 * Node의 ICU는 오전/오후를 'AM/PM'으로 내기도 해서 서버 렌더링과 하이드레이션이 어긋났다.
 * 형식은 브라우저 ko-KR 표기와 같다: '2026. 10. 14. 오후 12:04'(short는 '26. 10. 14.').
 */
const KST=9*3600_000;
const two=(n:number)=>String(n).padStart(2,'0');
function parts(ms:number){const d=new Date(ms+KST);return{y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate(),h:d.getUTCHours(),min:d.getUTCMinutes(),s:d.getUTCSeconds()};}
export function kstDate(ms:number,style:'medium'|'short'='medium'):string{
 const p=parts(ms);
 return `${style==='short'?two(p.y%100):p.y}. ${p.m}. ${p.d}.`;
}
export function kstTime(ms:number,seconds=false):string{
 const p=parts(ms),h=p.h%12===0?12:p.h%12;
 return `${p.h<12?'오전':'오후'} ${h}:${two(p.min)}${seconds?`:${two(p.s)}`:''}`;
}
export function kstDateTime(ms:number,opts:{date?:'medium'|'short';seconds?:boolean}={}):string{
 return `${kstDate(ms,opts.date)} ${kstTime(ms,opts.seconds)}`;
}
