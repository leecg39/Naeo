/**
 * 블로그 진단 점수(새 규칙 rules-v1). 원본 서비스의 가중치는 확인되지 않았으므로
 * RSS로 측정할 수 있는 5가지 기준을 각 20점으로 새로 정했다.
 */
export const METHOD_VERSION='rules-v1';
export type PostSample={title:string;category:string;tags:string[];publishedAt:number|null};
export type CriterionKey='cadence'|'recency'|'titles'|'tags'|'topic';
export type Criterion={key:CriterionKey;label:string;score:number;max:20;evidence:string};
export type ActionItem={criterion:CriterionKey;title:string};
export type AnalysisReport={methodVersion:string;score:number;criteria:Criterion[];actions:ActionItem[];disclosure:string;aiCitation:{status:'not_configured'}};

const DAY=86_400_000;
const clamp=(n:number)=>Math.max(0,Math.min(20,Math.round(n)));
const pct=(n:number)=>`${Math.round(n*100)}%`;
const ACTIONS:Record<CriterionKey,string>={
 cadence:'이번 주에 글 2개 이상 발행하기',
 recency:'오늘 새 글 하나 발행하기',
 titles:'제목을 15~45자로, 주제와 장소·숫자를 넣어 구체적으로 쓰기',
 tags:'글마다 주제 태그를 3개 이상 넣기',
 topic:'한 가지 주제(카테고리)에 글을 모아 전문성 보여주기'
};

function cadence(posts:PostSample[],now:number):Criterion{
 const recent=posts.filter(p=>p.publishedAt!==null&&now-p.publishedAt<=30*DAY).length;
 return{key:'cadence',label:'발행 빈도',max:20,score:clamp(recent/12*20),evidence:`최근 30일 글 ${recent}개 (12개 이상이면 만점)`};
}
function recency(posts:PostSample[],now:number):Criterion{
 const latest=Math.max(...posts.map(p=>p.publishedAt??0),0);
 if(!latest)return{key:'recency',label:'최근성',max:20,score:0,evidence:'발행일을 확인할 수 있는 글이 없습니다'};
 const days=Math.floor((now-latest)/DAY);
 const score=days<=3?20:days<=7?16:days<=14?12:days<=30?8:days<=90?4:0;
 return{key:'recency',label:'최근성',max:20,score,evidence:`마지막 글이 ${Math.max(0,days)}일 전 (3일 이내 만점)`};
}
function share(posts:PostSample[],test:(p:PostSample)=>boolean){return posts.length?posts.filter(test).length/posts.length:0;}
function titles(sample:PostSample[]):Criterion{
 const s=share(sample,p=>{const n=[...p.title.trim()].length;return n>=15&&n<=45;});
 return{key:'titles',label:'제목 구체성',max:20,score:clamp(s*20),evidence:`최근 글 ${sample.length}개 중 제목 15~45자 ${pct(s)}`};
}
function tags(sample:PostSample[]):Criterion{
 const s=share(sample,p=>p.tags.length>=3);
 return{key:'tags',label:'태그 활용',max:20,score:clamp(s*20),evidence:`최근 글 ${sample.length}개 중 태그 3개 이상 ${pct(s)}`};
}
function topic(sample:PostSample[]):Criterion{
 const counts=new Map<string,number>();
 for(const p of sample){const c=p.category||'(분류 없음)';counts.set(c,(counts.get(c)??0)+1);}
 const [top,n]=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]??['',0];
 const s=sample.length?n/sample.length:0;
 return{key:'topic',label:'주제 일관성',max:20,score:clamp(s/0.6*20),evidence:sample.length?`최근 글 ${pct(s)}가 '${top}' 분류 (60% 이상이면 만점)`:'분석할 글이 없습니다'};
}

/** 최신 글 30개(발행일·제목 순으로 정렬해 입력 순서와 무관)로 점수·근거·할 일을 만든다. */
export function analyzePosts(posts:PostSample[],now=Date.now()):AnalysisReport{
 const sorted=[...posts].sort((a,b)=>(b.publishedAt??0)-(a.publishedAt??0)||a.title.localeCompare(b.title));
 const sample=sorted.slice(0,30);
 const criteria=[cadence(sorted,now),recency(sorted,now),titles(sample),tags(sample),topic(sample)];
 return{
  methodVersion:METHOD_VERSION,score:criteria.reduce((s,c)=>s+c.score,0),criteria,
  actions:criteria.filter(c=>c.score<14).sort((a,b)=>a.score-b.score).map(c=>({criterion:c.key,title:ACTIONS[c.key]})),
  disclosure:'원본 서비스의 점수 가중치는 공개되지 않아 이 복제본의 새 규칙(rules-v1)으로 계산했습니다. 네이버 RSS에 공개된 최근 글만 사용합니다.',
  aiCitation:{status:'not_configured'}
 };
}
