'use client';

import {kstDateTime} from '@/lib/kst-time';
import {scoreChange,type DashboardVisualization} from '@/lib/dashboard-visualization';
import AnalysisSummary from './AnalysisSummary';
import AnalysisSources from './AnalysisSources';
import styles from './DashboardDiagnosis.module.css';

export default function DashboardDiagnosis({data, onConnect, connecting, connectError}:{data:DashboardVisualization; onConnect?:()=>void; connecting?:boolean; connectError?:string}){
 const latest=data.history[0],source=data.latestSource;
 return <section id="dashboard-diagnosis" aria-label="최근 블로그 분석 결과" className={styles.root}>
  <header className={styles.header}><div><h2>{data.subject?`${data.subject.naverId} 분석 결과`:'블로그 분석 결과'}</h2>
   <p>{latest?`공개 글 ${latest.postCount}개 분석 완료 · ${kstDateTime(latest.measuredAt)}`:'아직 저장된 분석 결과가 없습니다.'}</p></div>
   <div className={styles.headerActions}>
    {onConnect&&<button type="button" className={styles.connectBtn} onClick={onConnect} disabled={connecting}>{connecting?'내 블로그로 연결 중…':'내 블로그로 연결하기'}</button>}
    {latest?.source==='mate'&&<a href={`/mate/s?r=${encodeURIComponent(latest.id.slice(5))}`}>분석 리포트 열기 →</a>}
   </div>
  </header>
  {connectError&&<p role="alert" className={styles.connectError}>{connectError}</p>}
  {latest?<>
   <AnalysisSummary report={latest} postCount={latest.postCount} change={scoreChange(latest,data.history[1])}/>
   <p className={styles.notice}>저장된 {latest.source==='mate'?'무료 진단':'블로그 스캔'} 결과입니다. AI 인용·검색 노출은 별도로 확인한 값만 아래에 표시합니다.</p>
   {source&&<AnalysisSources key={latest.id} source={source} expanded={false}/>}
  </>:<div className={styles.empty}><p>{data.connected?'블로그 스캔을 완료하면 점수와 개선점을 이곳에서 확인할 수 있습니다.':'홈에서 공개 블로그를 분석하면 이곳에 결과가 표시됩니다.'}</p><a href={data.connected?'#dashboard-scan':'/'}>{data.connected?'블로그 스캔으로 이동':'블로그 분석하기'} →</a></div>}
 </section>;
}
