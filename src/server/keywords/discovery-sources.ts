import type {Database} from '../database';
import {autoKeyword} from '../citations/keywords';
import {phraseKey} from './recommendations';
import type {DiscoveredRecommendation,RecommendationMetricPoint,RecommendationRelated} from '../../lib/recommendation-feed';

export type DiscoveryCandidate={
 phrase:string;category:string;score:number;reason:string;source:DiscoveredRecommendation['source'];signal:DiscoveredRecommendation['signal'];
 sourcePost:DiscoveredRecommendation['sourcePost'];pcVolume:number|null;mobileVolume:number|null;documentCount:number|null;measuredAt:number|null;
 history:RecommendationMetricPoint[];related:RecommendationRelated[];
};
type Post={id:string;title:string;url:string;tags_json:string;category:string;keyword:string|null};
type Topic={phrase:string;count:number;post:Post};
const clean=(s:string)=>s.normalize('NFKC').replace(/<[^>]*>|\p{Cc}|\p{Extended_Pictographic}/gu,' ').replace(/^#+/,'').replace(/\s+/g,' ').trim();
const jsonTags=(value:string):string[]=>{try{const v:unknown=JSON.parse(value);return Array.isArray(v)?v.filter((s):s is string=>typeof s==='string').map(clean):[];}catch{return[];}};
const emptyMetrics={pcVolume:null,mobileVolume:null,documentCount:null,measuredAt:null};
const sourcePost=(post:Post)=>({id:post.id,title:post.title,url:post.url});
const tokens=(s:string)=>clean(s).split(/[^\p{L}\p{N}]+/u).filter(t=>t.length>=2&&!['추천','후기','정리','정보','블로그','이야기','오늘','일상'].includes(t));
export const metricPoint=(pcVolume:number,mobileVolume:number,documentCount:number|null,at:number,source:string):RecommendationMetricPoint=>({at,pcVolume,mobileVolume,total:pcVolume+mobileVolume,documentCount,saturation:documentCount===null||pcVolume+mobileVolume===0?null:documentCount/(pcVolume+mobileVolume),source});

/** 원본의 비공개 추천 알고리즘을 주장하지 않는다. 수집한 본인 글과 검증된 공개 지표로 후보를 설명 가능하게 만든다. */
export function localDiscoveryCandidates(db:Database,ownerId:string,blogId:string,now:number){
 const posts=db.prepare(`SELECT p.id,p.title,p.url,p.tags_json,p.category,k.keyword FROM blog_posts p JOIN blogs b ON b.id=p.blog_id
  LEFT JOIN post_keywords k ON k.post_id=p.id AND k.owner_id=b.owner_id WHERE b.owner_id=? AND b.id=? ORDER BY p.published_at DESC,p.collected_at DESC,p.id LIMIT 200`).all(ownerId,blogId) as Post[];
 const topicMap=new Map<string,Topic>(),known=new Set<string>();
 for(const post of posts){
  const tags=jsonTags(post.tags_json),primary=post.keyword??autoKeyword(post.title,tags)?.keyword;
  known.add(phraseKey(post.title));if(primary)known.add(phraseKey(primary));
  const values=[...(post.keyword?[post.keyword]:[]),...tags.slice(0,5),...(primary?[primary]:[])];
  for(const phrase of new Set(values.map(clean).filter(t=>t.length>=2&&t.length<=45))){
   const key=phraseKey(phrase),current=topicMap.get(key);
   if(current)current.count++;else topicMap.set(key,{phrase,count:1,post});
  }
 }
 const topics=[...topicMap.values()].sort((a,b)=>b.count-a.count||a.phrase.length-b.phrase.length).slice(0,12);
 const candidates=new Map<string,DiscoveryCandidate>();
 const add=(candidate:DiscoveryCandidate)=>{const key=phraseKey(candidate.phrase);if(candidate.phrase.length<2||candidate.phrase.length>60)return;const prev=candidates.get(key);if(!prev||candidate.score>prev.score)candidates.set(key,candidate);};
 const hasWritten=(phrase:string)=>known.has(phraseKey(phrase))||posts.some(p=>phraseKey(p.title).includes(phraseKey(phrase)));
 const allTokens=new Set(topics.flatMap(t=>tokens(t.phrase)));
 const related=(phrase:string)=>topics.filter(t=>phraseKey(t.phrase)!==phraseKey(phrase)).slice(0,5).map(t=>({phrase:t.phrase,pcVolume:null,mobileVolume:null,total:null,source:'blog_analysis' as const}));
 // 태그/대표 키워드와 실제 단어가 겹치는 공개 항목만 추천한다. 다른 회원의 글은 조회하지 않는다.
 const catalog=db.prepare(`SELECT k.id,k.phrase,k.category,m.pc_volume,m.mobile_volume,m.document_count,m.measured_at,m.source FROM keywords k
  LEFT JOIN keyword_metrics m ON m.id=(SELECT id FROM keyword_metrics WHERE keyword_id=k.id AND measured_at<=? ORDER BY measured_at DESC,created_at DESC,id LIMIT 1)
  WHERE k.status='active' ORDER BY k.phrase LIMIT 5000`).all(now) as {id:string;phrase:string;category:string;pc_volume:number|null;mobile_volume:number|null;document_count:number|null;measured_at:number|null;source:string|null}[];
 for(const k of catalog){
  if(hasWritten(k.phrase))continue;
  const matched=topics.find(t=>phraseKey(k.phrase).includes(phraseKey(t.phrase))||phraseKey(t.phrase).includes(phraseKey(k.phrase)));
  const overlap=tokens(k.phrase).filter(t=>allTokens.has(t)).length;
  if(!matched&&!overlap)continue;
  const topic=matched??topics.find(t=>tokens(t.phrase).some(v=>tokens(k.phrase).includes(v)))!;
  const metrics=k.pc_volume===null||k.mobile_volume===null?emptyMetrics:{pcVolume:k.pc_volume,mobileVolume:k.mobile_volume,documentCount:k.document_count,measuredAt:k.measured_at};
  const history=db.prepare('SELECT pc_volume,mobile_volume,document_count,measured_at,source FROM keyword_metrics WHERE keyword_id=? AND measured_at<=? ORDER BY measured_at DESC LIMIT 12').all(k.id,now) as {pc_volume:number;mobile_volume:number;document_count:number;measured_at:number;source:string}[];
  add({phrase:k.phrase,category:k.category||topic.post.category,score:70+Math.min(12,topic.count)+overlap,reason:`‘${topic.post.title}’에서 다룬 ‘${topic.phrase}’ 주제와 관련된 공개 키워드입니다. 수집한 기존 글에 이 키워드를 제목·대표 키워드로 사용한 기록이 없어 새 글감으로 추천합니다.`,source:'catalog',signal:'new',sourcePost:sourcePost(topic.post),...metrics,history:history.reverse().map(m=>metricPoint(m.pc_volume,m.mobile_volume,m.document_count,m.measured_at,m.source)),related:related(k.phrase)});
 }
 // 성공적으로 측정한 인용 결과만 비교한다. 오류 응답이나 일반 검색 노출(exposed)을 AI 인용(text/image rank)과 혼동하지 않는다.
 for(const post of posts){
  const results=db.prepare(`SELECT r.keyword,r.text_rank,r.image_rank,r.checked_at FROM citation_results r JOIN citation_runs run ON run.id=r.run_id
   WHERE r.owner_id=? AND r.blog_id=? AND r.post_id=? AND r.status='checked' AND run.state='succeeded' AND r.checked_at<=? ORDER BY r.checked_at DESC,r.id DESC LIMIT 20`).all(ownerId,blogId,post.id,now) as {keyword:string;text_rank:number|null;image_rank:number|null;checked_at:number}[];
  const current=results[0];if(!current||current.text_rank!==null||current.image_rank!==null)continue;
  const previous=results.slice(1).find(r=>phraseKey(r.keyword)===phraseKey(current.keyword));
  const lost=!!previous&&(previous.text_rank!==null||previous.image_rank!==null),phrase=post.keyword??current.keyword;
  // 대표 키워드를 바꾸었다면 다른 검색어의 과거 결과를 노출 하락 증거로 쓰지 않는다.
  const isLoss=lost&&phraseKey(phrase)===phraseKey(current.keyword);
  if(phraseKey(phrase)!==phraseKey(current.keyword))continue;
  add({phrase,category:post.category,score:isLoss?98:80,reason:isLoss?`‘${post.title}’의 같은 키워드 인용을 두 차례 정상 측정한 결과, 이전에는 AI 인용이 있었지만 최근에는 확인되지 않았습니다. 내용을 보완해 다시 작성할 후보입니다.`:`‘${post.title}’의 최근 정상 인용 측정에서 ‘${phrase}’ AI 인용이 확인되지 않았습니다. 해당 주제의 답변 구조와 내용을 보완할 후보입니다.`,source:'citation',signal:isLoss?'rewritten':'new',sourcePost:sourcePost(post),...emptyMetrics,history:[],related:related(phrase)});
 }
 // 공급자가 연결되지 않은 환경의 명시적 로컬 규칙. 추정 검색량/포화도를 만들지 않는다.
 for(const topic of topics.slice(0,8))for(const suffix of ['체크리스트','자주 묻는 질문','정리']){
  const phrase=`${topic.phrase} ${suffix}`;if(hasWritten(phrase))continue;
  add({phrase,category:topic.post.category,score:35+Math.min(15,topic.count),reason:`‘${topic.post.title}’에서 확인한 ‘${topic.phrase}’ 주제에 ‘${suffix}’ 구성을 적용한 분석 기반 글감 후보입니다. 로컬 규칙으로 추론했으며, 검색 수요는 아직 측정하지 않았습니다.`,source:'blog_analysis',signal:'new',sourcePost:sourcePost(topic.post),...emptyMetrics,history:[],related:related(phrase)});
 }
 return{posts,topics,candidates:[...candidates.values()].sort((a,b)=>b.score-a.score||a.phrase.localeCompare(b.phrase,'ko')),hasWritten};
}
