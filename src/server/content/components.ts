import type {CapturedNode} from '../../types/site';

type El=Exclude<CapturedNode,string>;
const el=(tag:string,attrs:Record<string,string>,children:CapturedNode[]=[]):El=>({tag,attrs,children});
const arrow=()=>el('span',{class:'MuiBox-root mui-1jhz9ir','aria-hidden':'true'},['→']);

export function eventCta(href:string,label:string,aria:string,note:CapturedNode[]):El{
 const children:CapturedNode[]=[el('a',{class:'MuiBox-root mui-bfpxs2',href},[label,arrow()])];
 if(note.length)children.push(el('p',{class:'MuiBox-root mui-1uk4353'},note));
 return el('aside',{class:'MuiBox-root mui-bgsx1o',...(aria?{'aria-label':aria}:{})},children);
}

export function ctaButton(href:string,label:string):El{
 return el('div',{class:'MuiBox-root mui-12hyhuy'},[el('a',{class:'MuiBox-root mui-udrcw6',href},[label])]);
}

export function picture(src:string,alt:string):El{
 return el('picture',{},[el('source',{media:'(max-width: 600px)'}),el('img',{src,alt})]);
}

/** 네이버 메이트 무료 진단 홍보 카드. 캡처된 기사 3개에서 동일하게 관찰된 원본 마크업. */
export function matePromo():El{
 const chip=(label:string)=>el('span',{class:'MuiBox-root mui-ges9ax'},[label]);
 return el('aside',{class:'MuiBox-root mui-tha3yc'},[
  el('div',{'aria-hidden':'true',class:'MuiBox-root mui-k0k3y7'}),
  el('div',{class:'MuiBox-root mui-17x0uqq'},[
   el('div',{class:'MuiBox-root mui-1e71ssz'},[el('img',{alt:'메이트 진단 점수 카드 예시, 공식 기준 5가지 충족도',class:'loaded MuiBox-root mui-1ma0sa6',src:'/assets/1a6cbb195f69b507.webp'})]),
   el('div',{class:'MuiBox-root mui-1kja2d9'},[
    el('div',{class:'MuiBox-root mui-1xmlb37'},[chip('무료'),chip('30초 진단'),chip('공식 기준 5가지')]),
    el('div',{class:'MuiBox-root mui-1n4krb6'},['내 블로그는 AI에 인용되고 있을까?']),
    el('div',{class:'MuiBox-root mui-1tfs3kw'},['블로그 주소만 넣으면 30초 만에 메이트가 공식 기준 5가지 충족도를 점수로 진단하고, 약점을 보완할 맞춤 글감까지 알려줍니다.']),
    el('a',{class:'MuiBox-root mui-1tc5htv',href:'/mate'},['30초 무료 진단받기',arrow()])
   ])
  ])
 ]);
}
