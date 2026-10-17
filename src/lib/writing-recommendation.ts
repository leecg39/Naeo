import type {DiscoveredRecommendation} from './recommendation-feed';

type Source=Pick<DiscoveredRecommendation,'phrase'|'signal'|'alreadyPublished'|'sourcePost'|'related'>;
export type WritingRecommendation={format:string;topic:string;titles:string[];audience:string;outline:{heading:string;guidance:string}[]};
export const writingTopic=(phrase:string)=>phrase.replace(/\s+(체크리스트|자주 묻는 질문|정리)$/u,'').trim();

/** 수집한 주제에 편집 구성을 제안한다. 생성된 사실·검색 수요·사용 경험을 주장하지 않는다. */
export function writingRecommendation(item:Source):WritingRecommendation{
 const topic=writingTopic(item.phrase)||item.phrase;
 const rewrite=item.signal==='rewritten'||item.alreadyPublished;
 const faq=item.phrase.endsWith('자주 묻는 질문'),checklist=item.phrase.endsWith('체크리스트');
 const format=rewrite?'기존 글 보완':faq?'질문과 답변':checklist?'실전 체크리스트':'입문 가이드';
 const titles=rewrite?[`${topic}, 기존 글에서 보완할 핵심 내용`,`${topic} 다시 정리하기: 달라진 점과 확인할 사항`,`${topic} 핵심 질문과 최신 근거 정리`]
  :faq?[`${topic} 자주 묻는 질문: 처음 접할 때 궁금한 점`,`${topic}, 시작 전에 알아둘 질문과 답변`,`${topic} Q&A: 개념부터 활용까지`]
  :checklist?[`${topic} 체크리스트: 시작 전에 확인할 사항`,`${topic} 실전 가이드: 준비부터 결과 확인까지`,`${topic} 시작하기, 놓치기 쉬운 점검 항목`]
  :[`${topic} 입문 가이드: 개념부터 활용까지`,`${topic} 핵심 정리: 처음 시작하는 분들을 위해`,`${topic} 활용법과 주의할 점 정리`];
 const outline=rewrite?[
  {heading:'기존 글의 핵심과 보완할 질문',guidance:'원문에서 이미 다룬 내용과 독자에게 더 필요한 답을 구분하세요.'},
  {heading:'달라진 내용과 확인 가능한 근거',guidance:'업데이트한 사실에 확인 날짜와 출처를 붙이세요. 변화가 없다면 있다고 쓰지 마세요.'},
  {heading:'구체적인 적용 예시',guidance:'직접 확인한 사례를 넣고, 설명용 예시는 가상 사례로 표시하세요.'},
  {heading:'요약과 다음 확인 항목',guidance:'수정한 내용과 아직 검증하지 못한 부분을 정리하세요.'},
 ]:faq?[
  {heading:`${topic}의 기본 개념은 무엇인가요?`,guidance:'낯선 용어를 풀어 설명하고 공식 자료를 근거로 정의하세요.'},
  {heading:'누구에게 필요하고 언제 활용하나요?',guidance:'독자의 상황별 활용 조건과 적합하지 않은 경우를 함께 설명하세요.'},
  {heading:'처음 시작하려면 무엇을 준비하나요?',guidance:'실제로 확인한 준비물과 순서를 정리하고 환경별 차이를 표시하세요.'},
  {heading:'사용하면서 주의할 점은 무엇인가요?',guidance:'자주 생기는 문제와 확인 방법을 제시하고 참고 자료로 연결하세요.'},
 ]:checklist?[
  {heading:'시작 전 준비 사항',guidance:'목적, 필요한 자료, 사용 환경을 점검 항목으로 적으세요.'},
  {heading:'단계별 실행 체크리스트',guidance:'한 항목에 한 가지 행동을 담고 완료를 확인할 기준을 덧붙이세요.'},
  {heading:'놓치기 쉬운 문제와 확인 방법',guidance:'확인한 제약과 해결 방법을 적고 추측은 구분하세요.'},
  {heading:'결과 확인과 다음 단계',guidance:'원하는 결과가 나왔는지 확인하는 방법과 참고 링크를 정리하세요.'},
 ]:[
  {heading:`${topic}의 개념과 필요한 이유`,guidance:'독자가 겪는 문제에서 시작해 핵심 개념을 쉽게 설명하세요.'},
  {heading:'시작하는 방법',guidance:'확인한 자료를 바탕으로 준비 사항과 실행 순서를 적으세요.'},
  {heading:'활용 예시와 한계',guidance:'검증한 사례와 가상 예시를 구분하고 적용할 수 없는 조건도 설명하세요.'},
  {heading:'핵심 요약과 참고 자료',guidance:'독자가 가져갈 핵심 내용과 출처를 정리하세요.'},
 ];
 return{format,topic,titles,audience:`${topic}에 관심이 있지만 어디서 시작할지 고민하는 독자`,outline};
}

export function featuredWritingRecommendations(items:DiscoveredRecommendation[],limit=3){
 const seen=new Set<string>();
 return items.filter(item=>{
  const topic=writingTopic(item.phrase).normalize('NFKC').toLowerCase().replace(/\s+/g,'');
  if(item.written||item.dismissed||['첫글','첫게시글','첫포스팅'].includes(topic)||seen.has(topic))return false;
  seen.add(topic);return true;
 }).slice(0,limit);
}

const markdownText=(s:string)=>s.replace(/[<>]/g,'').replace(/[\\`*_{}[\]()#+.!|~-]/g,'\\$&').replace(/[\r\n]+/g,' ');
export function writingRecommendationBody(item:Source,plan=writingRecommendation(item)){
 const source=item.sourcePost;
 return[
  '> 글쓰기 구성 초안입니다. 각 항목에 직접 확인한 내용과 경험을 채워주세요.',
  `독자: ${markdownText(plan.audience)}`,
  ...plan.outline.map(section=>`## ${markdownText(section.heading)}\n\n${section.guidance}`),
  '## 참고 자료',
  ...(source?[`분석한 내 글: ${markdownText(source.title)}`,source.url]:[]),
  '추가로 확인한 공식 자료와 확인 날짜를 적어주세요.',
 ].join('\n\n');
}
