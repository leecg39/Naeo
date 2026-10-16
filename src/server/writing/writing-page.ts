import {getCapturedPage} from '../../lib/pages';
import {kstDate} from '../../lib/kst-time';
import type {Database} from '../database';
import {memberChrome} from '../content/member-chrome';
import {balance} from '../credits/ledger';
import {currentSubscription} from '../billing/subscriptions';
import {GENERATION_COST,generationAvailability} from '../generation/generation';
import {listRecommendations} from '../keywords/recommendations';
import {isTrackingPixel} from '../content/blog-pages';
import {find,hasClass,mapTree,textOf,withAttrs,withChildren,type El} from '../content/tree';

const el=(tag:string,attrs:Record<string,string>,children:El['children']):El=>({tag,attrs,children});
const paragraph=(text:string)=>el('p',{},[text]);
function recommendations(db:Database,userId:string,now:number):El[]{
 const rows=listRecommendations(db,userId,{pageSize:10},now).data;
 return [el('h2',{style:'font-size:18px;margin:0 0 12px'},['추천 키워드']),paragraph('등록된 공개 키워드입니다. 선택하면 글감으로 사용할 수 있습니다.'),
  ...(rows.length?rows.map(r=>el('a',{href:`/dashboard/write?keyword=${encodeURIComponent(r.phrase)}`,style:'display:block;padding:8px 0;color:#03c75a;overflow-wrap:anywhere'},[r.phrase])):[paragraph('등록된 추천 키워드가 없습니다.')]),
  el('a',{href:'/dashboard/recommendations',style:'display:block;margin-top:12px;color:#03c75a'},['키워드 추천 전체 보기 →'])];
}

/** 캡처의 체험·잔액·추천을 로그인 회원의 서버 데이터로 바꾼다. */
export async function buildWritingPage(db:Database,userId:string,now=Date.now()){
 const page=await getCapturedPage('/dashboard/write');
 if(!page)throw new Error('writing template missing');
 const tokens=balance(db,userId),sub=currentSubscription(db,userId,now);
 const generation=generationAvailability(db,userId);
 const plan=sub?`${sub.planName} ${sub.trial?'체험 중':'이용 중'} · ${kstDate(sub.currentPeriodEnd)}까지`:'이용 중인 구독 없음';
 const credit=(n:El)=>withAttrs(withChildren(n,[`잔액 ${tokens}토큰`]),{'data-credit-balance':'true'});
 const body=mapTree(page.body.filter(n=>!isTrackingPixel(n)),n=>{
  if(n.attrs.role==='status'&&find(n.children,hasClass('mui-1a0o2bi')))return[];
  if(hasClass('mui-1a0o2bi')(n))return[]; // 캡처 당시의 고정 이벤트 홍보.
  if(hasClass('mui-sw3xbd')(n))return[withChildren(n,[paragraph(plan),credit(paragraph('')),paragraph(`글 생성 ${GENERATION_COST}토큰 · 실패·취소 시 환급`),paragraph(generation==='openai_oauth'?'연결한 ChatGPT 계정으로 글을 생성합니다. AI 이미지는 미설정이며 내 사진을 사용할 수 있습니다.':generation==='anthropic'?'서버 AI 공급자로 글을 생성합니다. AI 이미지는 미설정이며 내 사진을 사용할 수 있습니다.':'AI 글·이미지 공급자 미설정. 계정 설정에서 ChatGPT를 연결하거나 직접 작성·저장할 수 있습니다.')])];
  if(hasClass('mui-1a3imsy')(n))return[withChildren(n,recommendations(db,userId,now))];
  if(n.tag==='button'&&textOf(n).startsWith('글 생성하기'))return[withChildren(n,[`글 생성하기 (${GENERATION_COST}토큰)`])];
  if(!n.children.every(c=>typeof c==='string'))return undefined;
  const text=textOf(n);
  if(text.startsWith('→ 총'))return[withChildren(n,['→ 총 이미지 수는 내 사진 수와 같습니다(AI 이미지 미설정).'])];
  if(/^(잔여 )?175토큰$/.test(text))return[credit(n)];
  if(text.startsWith('오늘 2편')||text.startsWith('첫 장은 제목 썸네일'))return[withChildren(n,['AI 이미지 생성은 미설정입니다. 내 사진을 올리거나 글만 생성할 수 있습니다.'])];
  if(text.includes('글자 수·문체·구성은'))return[withChildren(n,['선택한 주제와 입력한 경험·요청사항을 글 생성에 반영합니다.'])];
  if(text.includes('인용 상위 제목 공식'))return[withChildren(n,['비우면 키워드와 입력 내용을 바탕으로 제목을 만듭니다.'])];
  return undefined;
 });
 return memberChrome(db,userId,{...page,body,source:'database'},now);
}
