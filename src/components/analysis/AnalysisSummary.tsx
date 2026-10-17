'use client';

import {useId} from 'react';
import type {AnalysisReport} from '@/server/analysis/rules';
import styles from './DashboardCharts.module.css';

const level=(score:number,max:number)=>score/max>=.7?'양호':score/max>=.4?'보완 필요':'우선 개선';
const tone=(score:number,max:number)=>score/max>=.7?'var(--viz-green)':score/max>=.4?'var(--viz-amber)':'var(--viz-red)';

/** Shared by the dashboard and free diagnosis report; values always come from a saved report. */
export default function AnalysisSummary({report,postCount,change=null}:{report:AnalysisReport;postCount:number;change?:number|null}){
 const titleId=useId();
 const criteria=report.criteria;
 const point=(i:number,ratio:number)=>{const a=-Math.PI/2+i*2*Math.PI/criteria.length;return`${150+Math.cos(a)*88*ratio},${126+Math.sin(a)*88*ratio}`;};
 const weakest=[...criteria].sort((a,b)=>a.score/a.max-b.score/b.max)[0];
 return <section className={`${styles.theme} ${styles.panel}`} aria-labelledby={titleId}>
  <div className={styles.heading}><div><h2 id={titleId}>내 블로그 진단</h2><p>공개 글 {postCount}개를 바탕으로 분석한 5가지 기준</p></div><span className={styles.pill}>100점 만점</span></div>
  <div className={styles.summary}>
   <div className={styles.scoreBlock}>
    <div className={styles.gauge}>
     <svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="68" className={styles.ringTrack}/><circle cx="80" cy="80" r="68" fill="none" stroke="var(--viz-green)" strokeWidth="10" strokeLinecap="round" pathLength="100" strokeDasharray={`${Math.max(0,Math.min(100,report.score))} 100`} transform="rotate(-90 80 80)"/></svg>
     <div><span>종합 점수</span><strong>{report.score}<small>점</small></strong></div>
    </div>
    <p className={styles.delta} style={change!==null&&change<0?{color:'var(--viz-red)'}:undefined}>{change===null?'첫 진단 또는 새 평가 기준':change===0?'이전 진단과 동일':`이전 진단 대비 ${change>0?'+':''}${change}점`}</p>
    <p className={styles.scoreHint}>{weakest&&weakest.score/weakest.max<.7?`${weakest.label}부터 개선해 보세요.`:'각 기준을 고르게 유지하고 있어요.'}</p>
   </div>
   <div className={styles.radar}>
    <svg viewBox="0 0 300 260" role="img" aria-label={`5개 기준 분포: ${criteria.map(c=>`${c.label} ${c.score}/${c.max}점`).join(', ')}`}>
     {[.25,.5,.75,1].map(r=><polygon key={r} points={criteria.map((_,i)=>point(i,r)).join(' ')} fill="none" stroke="var(--viz-line)"/>)}
     {criteria.map((c,i)=><line key={c.key} x1="150" y1="126" x2={point(i,1).split(',')[0]} y2={point(i,1).split(',')[1]} stroke="var(--viz-line)"/>)}
     <polygon points={criteria.map((c,i)=>point(i,c.score/c.max)).join(' ')} fill="var(--viz-green)" fillOpacity=".13" stroke="var(--viz-green)" strokeWidth="2"/>
     {criteria.map((c,i)=>{const [x,y]=point(i,1.26).split(',');const [cx,cy]=point(i,c.score/c.max).split(',');return <g key={c.key}><circle cx={cx} cy={cy} r="3" fill="var(--viz-green)"/><text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="var(--viz-muted)" fontSize="11">{c.label}</text></g>;})}
    </svg>
   </div>
   <div className={styles.criteria}>{criteria.map(c=><div key={c.key} className={styles.criterion}>
    <div><strong>{c.label}</strong><span style={{color:tone(c.score,c.max)}}>{level(c.score,c.max)} <b>{c.score}</b><small> / {c.max}</small></span></div>
    <progress aria-label={`${c.label} ${c.score}/${c.max}점`} value={c.score} max={c.max} style={{accentColor:tone(c.score,c.max),color:tone(c.score,c.max)}}/>
    <p>{c.evidence}</p>
   </div>)}</div>
  </div>
  <p className={styles.footnote}>네이버 RSS 공개 글 기준 · {report.methodVersion} · 진단 점수와 실제 AI 인용 여부는 별도로 측정합니다.</p>
 </section>;
}
