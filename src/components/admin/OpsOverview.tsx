import {kstDateTime} from '@/lib/kst-time';
import type {analyticsSummary} from '@/server/ops/analytics';
import type {serviceHealth} from '@/server/ops/health';

type Summary=ReturnType<typeof analyticsSummary>;type Health=ReturnType<typeof serviceHealth>;
const LABEL:Record<keyof Health['integrations'],string>={ai:'AI 글 생성',aiCitation:'AI 인용 확인',payments:'결제(토스)',google:'Google 로그인',naver:'네이버 로그인',mail:'계정 안내 메일',sms:'문자 인증'};
const time=(ms:number)=>kstDateTime(ms,{seconds:true});
/** 운영 현황: 방문 통계(개인정보 최소화 집계)와 서비스 상태. 서버에서 그린다. */
export default function OpsOverview({summary,health}:{summary:Summary;health:Health}){
 const total=summary.daily.reduce((a,d)=>({views:a.views+d.views,visitors:a.visitors+d.visitors}),{views:0,visitors:0});
 return <>
  <section className="panel account-card" aria-label="방문 통계">
   <h2>최근 {summary.days}일 방문</h2>
   <p>페이지 보기 <strong>{total.views.toLocaleString('ko-KR')}</strong> · 일별 방문자(그날 고유) 합 <strong>{total.visitors.toLocaleString('ko-KR')}</strong></p>
   <p className="muted">IP·전체 주소는 저장하지 않고, 방문자는 매일 바뀌는 값으로만 셉니다. 추적 거부(DNT·GPC)·봇·관리 화면은 제외됩니다. 원본 기록은 30일 뒤 삭제됩니다.</p>
   {summary.daily.length?<div className="responsive-table"><table className="data-table"><caption className="sr-only">일별 방문</caption><thead><tr><th>날짜</th><th>보기</th><th>방문자</th></tr></thead>
    <tbody>{summary.daily.map(d=><tr key={d.day}><td>{d.day}</td><td>{d.views}</td><td>{d.visitors}</td></tr>)}</tbody></table></div>:<p className="muted">아직 기록이 없습니다.</p>}
   {summary.topPaths.length>0&&<div className="responsive-table"><table className="data-table"><caption className="sr-only">많이 본 페이지</caption><thead><tr><th>페이지</th><th>보기</th><th>방문자</th><th>평균 체류</th></tr></thead>
    <tbody>{summary.topPaths.slice(0,10).map(p=><tr key={p.path}><td>{p.path}</td><td>{p.views}</td><td>{p.visitors}</td><td>{p.avgDwellSec===null?'-':`${p.avgDwellSec}초`}</td></tr>)}</tbody></table></div>}
   {summary.referrers.length>0&&<p className="muted">유입: {summary.referrers.map(r=>`${r.host} ${r.views}`).join(' · ')}</p>}
  </section>
  <section className="panel account-card" aria-label="서비스 상태">
   <h2>서비스 상태</h2>
   <p>DB 스키마 {health.schemaVersion} · 작업자 {health.workers.filter(w=>w.alive).length}개 동작 중{health.workers.length?` (마지막 신호 ${time(health.workers[0].lastSeenAt)})`:''}</p>
   {!health.workers.some(w=>w.alive)&&<p role="alert" className="account-error">작업자 신호가 2분 넘게 없습니다. 진단·글 생성·정리 작업이 멈춰 있을 수 있어요.</p>}
   <p>진단 큐 대기 {health.queues.scan.queued}·진행 {health.queues.scan.running}·24시간 실패 {health.queues.scan.failed24h} / 글 생성 대기 {health.queues.generation.queued}·진행 {health.queues.generation.running}·24시간 실패 {health.queues.generation.failed24h} / 내보내기 수집 중 {health.queues.exportsCollecting}</p>
   <p>계정 안내 메일 대기·처리 중 {health.mailQueue.pending}건 · 실패 {health.mailQueue.failed}건</p>
   <p>사진 파일 삭제 대기 {health.mediaDeletion.pending}건 · 재시도 {health.mediaDeletion.retrying}건</p>
   {health.mediaDeletion.retrying>0&&<p role="alert" className="account-error">삭제하지 못한 사진 파일이 있습니다. 업로드 폴더의 접근 권한과 작업자 로그를 확인해주세요. 파일 삭제는 자동으로 재시도됩니다.</p>}
   <ul style={{display:'flex',flexWrap:'wrap',gap:8,listStyle:'none',padding:0,margin:0}} aria-label="외부 연동">{(Object.keys(LABEL) as (keyof Health['integrations'])[]).map(k=><li key={k} className="muted" data-integration={k} data-configured={health.integrations[k]}>{LABEL[k]}: {health.integrations[k]?'설정됨':'미설정'}</li>)}</ul>
  </section>
 </>;
}
