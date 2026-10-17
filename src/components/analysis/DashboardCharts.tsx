'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {chartCoordinates,inPeriod,percentage,scoreChange,type ChartPeriod,type DashboardVisualization} from '@/lib/dashboard-visualization';
import AnalysisSummary from './AnalysisSummary';
import styles from './DashboardCharts.module.css';

const date=(ms:number)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit'}).format(ms);
const time=(ms:number)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(ms);
type Series={label:string;color:string;values:{id:string;measuredAt:number;value:number;detail:string}[]};

function TrendChart({series,unit,label}:{series:Series[];unit:string;label:string}){
 const uid=useId().replace(/:/g,'');
 const [selected,setSelected]=useState<string|null>(null);
 const plot=useRef<HTMLDivElement>(null);
 const [width,setWidth]=useState(800);
 const all=series.flatMap(s=>s.values).sort((a,b)=>a.measuredAt-b.measuredAt);
 const start=all[0]?.measuredAt??0,end=all.at(-1)?.measuredAt??start;
 const active=series.flatMap(s=>s.values.map(p=>({...p,label:s.label}))).filter(p=>p.id===selected);
 const hasPoints=all.length>0;
 useEffect(()=>{
  const element=plot.current;
  if(!element)return;
  const observer=new ResizeObserver(([entry])=>setWidth(Math.max(280,Math.round(entry.contentRect.width))));
  observer.observe(element);
  return()=>observer.disconnect();
 },[hasPoints]);
 if(!all.length)return <div className={styles.empty}>이 기간에 측정된 기록이 없습니다.<br/><span>기간을 바꾸거나 새 분석을 진행해 주세요.</span></div>;
 const coordinate=(s:Series)=>chartCoordinates([{measuredAt:start,value:0},...s.values,{measuredAt:end,value:0}],100,width).slice(1,-1);
 return <>
  <div className={styles.plot} ref={plot}>
   <svg viewBox={`0 0 ${width} 245`} role="group" aria-label={label}>
    <defs>{series.map((s,i)=><linearGradient id={`${uid}-${i}`} key={s.label} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={s.color} stopOpacity=".22"/><stop offset="100%" stopColor={s.color} stopOpacity="0"/></linearGradient>)}</defs>
    {[0,25,50,75,100].map(value=><g key={value}><line x1="48" x2={width-24} y1={208-value*1.8} y2={208-value*1.8} stroke="var(--viz-line)" strokeDasharray="3 5"/><text x="34" y={212-value*1.8} textAnchor="end" fill="var(--viz-muted)" fontSize="11">{value}</text></g>)}
    {series.map((s,si)=>{const pts=coordinate(s);const line=pts.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join(' ');return <g key={s.label}>
     {pts.length>1&&<><path d={`${line} L${pts.at(-1)!.x},208 L${pts[0].x},208 Z`} fill={`url(#${uid}-${si})`}/><path d={line} stroke={s.color} strokeWidth="2.5" fill="none" strokeLinejoin="round"/></>}
     {pts.map((p,i)=><g key={s.values[i].id} role="button" tabIndex={0} aria-label={`${time(p.measuredAt)} ${s.label} ${p.value}${unit}. ${s.values[i].detail}`} onFocus={()=>setSelected(s.values[i].id)} onMouseEnter={()=>setSelected(s.values[i].id)} onClick={()=>setSelected(s.values[i].id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(s.values[i].id);}}} className={styles.chartPoint}>
      <circle cx={p.x} cy={p.y} r="15" fill="transparent"/><circle cx={p.x} cy={p.y} r={selected===s.values[i].id?5:3.5} fill="var(--viz-bg)" stroke={s.color} strokeWidth="2"/><title>{`${time(p.measuredAt)} · ${s.label} ${p.value}${unit} · ${s.values[i].detail}`}</title>
     </g>)}
    </g>;})}
    <text x={start===end?width/2:48} y="237" textAnchor={start===end?'middle':'start'} fill="var(--viz-muted)" fontSize="11">{date(start)}</text>
    {start!==end&&<text x={width-24} y="237" textAnchor="end" fill="var(--viz-muted)" fontSize="11">{date(end)}</text>}
   </svg>
  </div>
  <div className={styles.legend}>{series.map(s=><span key={s.label}><i style={{background:s.color}}/>{s.label} ({unit})</span>)}</div>
  <p className={styles.readout} aria-live="polite">{active.length?`${time(active[0].measuredAt)} · ${active.map(p=>`${p.label} ${p.value}${unit} (${p.detail})`).join(' · ')}`:'그래프의 점에 마우스를 올리거나 키보드로 선택하면 측정값을 볼 수 있어요.'}</p>
 </>;
}

export default function DashboardCharts({data}:{data:DashboardVisualization}){
 const router=useRouter();
 const [period,setPeriod]=useState<ChartPeriod>(30);
 const [metric,setMetric]=useState<'score'|'citation'>('score');
 const latest=data.history[0],previous=data.history[1],citation=data.citations[0];
 const points=inPeriod(data.history,period,data.now),citations=inPeriod(data.citations,period,data.now);
 const valid=citations.filter(p=>p.checked>0);
 const chartId=useId(),headingId=useId();
 const stateMessage={ready:'',running:'인용 확인 중입니다. 완료되면 새 결과가 반영됩니다.',failed:'최근 인용 확인에 실패했습니다. 아래에는 마지막으로 완료된 결과를 표시합니다.',not_configured:'AI 인용 확인이 아직 설정되지 않았습니다. 확인 전 수치는 표시하지 않습니다.',empty:'아직 AI 인용 확인 기록이 없습니다. 블로그 스캔 후 인용 현황에서 확인해 주세요.'}[data.citationState];
 const series:Series[]=metric==='score'?[{label:'진단 점수',color:'var(--viz-green)',values:points.map(p=>({id:p.id,measuredAt:p.measuredAt,value:p.score,detail:`공개 글 ${p.postCount}개 · ${p.methodVersion}`}))}]:[
  {label:'AI 인용률',color:'var(--viz-green)',values:valid.map(p=>({id:p.id,measuredAt:p.measuredAt,value:percentage(p.cited,p.checked)!,detail:`${p.cited}/${p.checked}개 글`}))},
  {label:'통합검색 노출률',color:'var(--viz-red)',values:valid.map(p=>({id:p.id,measuredAt:p.measuredAt,value:percentage(p.exposed,p.checked)!,detail:`${p.exposed}/${p.checked}개 글`}))}
 ];
 return <div id="dashboard-diagnosis" data-naeo-live="dashboard-charts" className={`${styles.theme} ${styles.stack}`}>
  {data.subject&&<section className={`${styles.panel} ${styles.subjectPanel}`} aria-label="분석할 블로그 선택">
   <div className={styles.subjectControl}><label htmlFor={`${headingId}-blog`}>분석 블로그</label><select id={`${headingId}-blog`} value={data.subject.naverId} onChange={e=>router.push(`/dashboard?blog=${encodeURIComponent(e.target.value)}`)}>{data.subjects.map(b=><option value={b.naverId} key={b.naverId}>{b.title}{b.title!==b.naverId?` (@${b.naverId})`:''}{b.primary?' · 대표':''}</option>)}</select></div>
   <div className={styles.subjectInfo}><p>{latest?`${latest.source==='mate'?'무료 진단':'블로그 스캔'} · ${time(latest.measuredAt)}`:'아직 진단 기록이 없습니다.'}</p>{!data.connected&&<span>저장된 무료 진단을 표시합니다. <a className={styles.link} href="/dashboard/settings">블로그 연결하기 →</a></span>}<a href="/dashboard/mate" className={styles.link}>진단 기록 보기 →</a></div>
  </section>}
  {latest?<AnalysisSummary report={latest} postCount={latest.postCount} change={scoreChange(latest,previous)}/>:<section className={styles.panel}><h2>내 블로그 진단</h2><div className={styles.empty}>{data.connected?'첫 스캔을 완료하면 종합 점수와 5개 기준 분석을 보여드립니다.':'블로그를 연결하고 첫 진단을 시작해 보세요.'}<a href={data.connected?'#dashboard-scan':'/dashboard/settings'}>{data.connected?'블로그 스캔으로 이동':'블로그 연결하기'} →</a></div></section>}
  <section className={styles.panel} aria-labelledby={headingId}>
   <div className={styles.heading}><div><h2 id={headingId}>블로그 성장 추세</h2><p>실제 분석 기록으로 점수와 검색 성과의 변화를 확인하세요.</p></div><div className={styles.periods} role="group" aria-label="성장 추세 기간">{([7,30,90,'all'] as const).map(p=><button key={p} type="button" aria-pressed={period===p} onClick={()=>setPeriod(p)}>{p==='all'?'전체':`${p}일`}</button>)}</div></div>
   <div className={styles.chartHeader}><div className={styles.metricTabs} role="group" aria-label="성장 추세 지표"><button type="button" aria-pressed={metric==='score'} onClick={()=>setMetric('score')}>진단 점수</button><button type="button" aria-pressed={metric==='citation'} onClick={()=>setMetric('citation')}>AI 인용·검색 노출</button></div><span className={styles.muted}>{period==='all'?'보관 기록':`최근 ${period}일`} · {metric==='score'?points.length:valid.length}회 측정</span></div>
   <div id={chartId} data-score-chart={metric==='score'?'true':undefined}><TrendChart key={`${period}-${metric}`} series={series} unit={metric==='score'?'점':'%'} label={metric==='score'?'진단 점수 추이':'AI 인용률과 통합검색 노출률 추이'}/></div>
   {metric==='citation'&&citations.some(p=>p.errors>0)&&<p className={styles.footnote}>확인에 실패한 글은 비율 계산에서 제외했습니다. 성공한 글이 0개인 기록은 그래프에 표시하지 않습니다.</p>}
   <details className={styles.details}><summary>측정 기록 자세히 보기</summary><div className={styles.tableScroll}><table><caption className={styles.srOnly}>선택한 기간의 {metric==='score'?'진단':'인용'} 측정 기록</caption><thead><tr><th>측정 시각 (한국 시간)</th>{metric==='score'?<><th>점수</th><th>분석한 글</th><th>평가 기준</th><th>진단 경로</th></>:<><th>AI 인용</th><th>검색 노출</th><th>확인 실패</th></>}</tr></thead><tbody>{metric==='score'?[...points].reverse().map(p=><tr key={p.id}><td>{time(p.measuredAt)}</td><td>{p.score}점</td><td>{p.postCount}개</td><td>{p.methodVersion}</td><td>{p.source==='mate'?'무료 진단':'블로그 스캔'}</td></tr>):[...citations].reverse().map(p=><tr key={p.id}><td>{time(p.measuredAt)}</td><td>{p.checked?`${p.cited}/${p.checked}개 (${percentage(p.cited,p.checked)}%)`:'확인 불가'}</td><td>{p.checked?`${p.exposed}/${p.checked}개 (${percentage(p.exposed,p.checked)}%)`:'확인 불가'}</td><td>{p.errors}개</td></tr>)}</tbody></table></div></details>
   <p className={styles.footnote}>같은 블로그의 최근 365회 진단을 표시합니다. 무료 진단은 30일 동안 보관하며, 기록이 없는 날은 0으로 계산하지 않습니다.</p>
  </section>
  <section className={styles.panel} aria-label="AI 인용 분석 결과">
   <div className={styles.heading}><div><h2>AI 인용 · 검색 성과</h2><p>{citation?`${time(citation.measuredAt)} 마지막 확인`:'실제 검색 결과를 확인한 후 표시됩니다.'}</p></div><a href={data.connected?data.citationHref:'/dashboard/settings'} className={styles.link}>{data.connected?'AI 인용 현황':'블로그 연결하기'} →</a></div>
   {stateMessage&&<p className={styles.notice} role="status">{stateMessage}</p>}
   <div className={styles.kpis}>{([{label:'AI 인용률',count:citation?.cited,color:'var(--viz-green)'},{label:'통합검색 노출률',count:citation?.exposed,color:'var(--viz-red)'}]).map(k=>{const rate=percentage(k.count??0,citation?.checked??0);return <div className={styles.kpi} key={k.label}><span>{k.label}</span><strong style={{color:k.color}}>{rate===null?'—':rate}<small>{rate===null?'':'%'}</small></strong><p>{rate===null?'아직 확인된 글이 없습니다':`${k.count} / ${citation.checked}개 글`}</p><div className={styles.meter}><span style={{width:`${rate??0}%`,background:k.color}}/></div></div>;})}</div>
   {!!citation?.errors&&<p className={styles.footnote}>확인 실패 {citation.errors}개는 인용률·노출률 계산에서 제외했습니다.</p>}
   {data.citedPosts.length>0&&<div className={styles.postGrid}>{data.citedPosts.map(post=><a key={post.id} href={`${data.citationHref}&open=${encodeURIComponent(post.id)}`} className={styles.post}><span className={styles.pill}>내 글 인용</span><h3>{post.title}</h3><p>{post.keyword}</p><div>{post.textRank!==null&&<span>본문 출처 {post.textRank}위</span>}{post.imageRank!==null&&<span>이미지 출처 {post.imageRank}위</span>}</div><small>인용 상세 보기 ↗</small></a>)}</div>}
  </section>
 </div>;
}
