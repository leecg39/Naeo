'use client';

import {useEffect, useId, useRef, useState} from 'react';
import {ArrowRight, Check, ChevronLeft, ChevronRight, ExternalLink, Sparkles, X} from 'lucide-react';
import type {DashboardBriefing, DashboardChange, DashboardOverview as OverviewData, DashboardRankCard} from '@/lib/dashboard-overview';
import {inPeriod, percentage, type ChartPeriod, type CitationPoint, type DashboardVisualization} from '@/lib/dashboard-visualization';
import DashboardCharts from './DashboardCharts';
import styles from './DashboardOverview.module.css';

const DAY = 86_400_000;
const number = (value:number|null) => value === null ? '—' : value.toLocaleString('ko-KR');
const date = (value:number) => new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', month:'2-digit', day:'2-digit'}).format(value);
const time = (value:number) => new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false}).format(value);
const safeUrl = (value:string) => /^(https?:\/\/|\/(?!\/))/.test(value) ? value : undefined;
const plain = (value:string) => value.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(^|\n)\s*#{1,6}\s+/g, '$1').replace(/[*_`]/g, '').trim();
const statusHref = (href:string, status:string) => `${href}${href.includes('?') ? '&' : '?'}status=${status}`;
const signals = {new:'신규', revisit:'재추천', rewritten:'리라이트', opportunity:'선점기회'};

function relativeTime(at:number, now:number) {
 const minutes = Math.max(0, Math.floor((now - at) / 60_000));
 if (minutes < 1) return '방금 전';
 if (minutes < 60) return `${minutes}분 전`;
 if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
 return `${Math.floor(minutes / 1440)}일 전`;
}

function Empty({children, href, action}:{children:React.ReactNode; href?:string; action?:string}) {
 return <div className={styles.empty}><p>{children}</p>{href && <a className={styles.link} href={href}>{action ?? '자세히 보기'} <ArrowRight size={13}/></a>}</div>;
}

function PeriodButtons({value, onChange, feed=false}:{value:ChartPeriod; onChange:(period:ChartPeriod)=>void; feed?:boolean}) {
 const periods:ChartPeriod[] = feed ? [7,30,'all'] : [7,30,90,'all'];
 return <div className={styles.periods} role="group" aria-label={feed ? '변화 피드 기간' : '성장 추세 기간'}>{periods.map(period => <button key={period} type="button" aria-pressed={value === period} onClick={() => onChange(period)}>{period === 'all' ? '전체' : feed ? period === 7 ? '일주일' : '한달' : `${period}일`}</button>)}</div>;
}

function BriefingDialog({items, initial, close}:{items:DashboardBriefing[]; initial:number; close:()=>void}) {
 const [index,setIndex] = useState(initial);
 const dialog = useRef<HTMLDialogElement>(null);
 const titleId = useId();
 const item = items[index];
 useEffect(() => {
  const element = dialog.current;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  element?.showModal();
  return () => {element?.close(); opener?.focus();};
 }, []);
 if (!item) return null;
 const move = (offset:number) => setIndex(current => Math.max(0,Math.min(items.length-1,current+offset)));
 return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onClose={() => {if (!dialog.current?.open) close();}} onClick={event => {if(event.target === event.currentTarget) close();}} onKeyDown={event => {
  if(event.key === 'ArrowLeft') {event.preventDefault();move(-1);}
  if(event.key === 'ArrowRight') {event.preventDefault();move(1);}
 }}>
  <div className={styles.dialogContent}>
   <header className={styles.dialogHeader}><div><span className={styles.eyebrow}>저장된 AI 브리핑</span><h2 id={titleId}>{item.keyword || item.title}</h2><p>{time(item.checkedAt)} 확인</p></div><button type="button" className={styles.iconButton} onClick={close} aria-label="브리핑 상세 닫기" autoFocus><X size={20}/></button></header>
   <div className={styles.dialogBody}>
    {item.cited && <span className={styles.citedBadge}><Check size={12}/> 내 글 인용</span>}
    {item.media.some(media => safeUrl(media.thumbnail)) && <div className={styles.mediaGrid}>{item.media.filter(media => safeUrl(media.thumbnail)).map((media,index) => <a key={`${media.url}-${index}`} href={safeUrl(media.url)} target="_blank" rel="noopener noreferrer"><img src={safeUrl(media.thumbnail)} alt={media.title || '브리핑에 포함된 이미지'} referrerPolicy="no-referrer"/><span>{media.title}</span></a>)}</div>}
    <div className={styles.briefingBody}>{item.markdown ? item.markdown.split(/\n\s*\n/).map((paragraph,index) => <p key={index}>{plain(paragraph)}</p>) : <p>저장된 브리핑 본문이 없습니다. 아래 출처에서 내용을 확인해 주세요.</p>}</div>
    {!!item.references.length && <section className={styles.references}><h3>출처 {item.references.length}개</h3><ol>{item.references.map((reference,index) => <li key={`${reference.url}-${index}`}><a href={safeUrl(reference.url)} target="_blank" rel="noopener noreferrer">{reference.title || reference.url}<ExternalLink size={12}/></a></li>)}</ol></section>}
   </div>
   <footer className={styles.dialogFooter}><div className={styles.dialogPager}><button type="button" className={styles.iconButton} disabled={index === 0} onClick={() => move(-1)} aria-label="이전 브리핑"><ChevronLeft size={18}/></button><span aria-live="polite">{index+1} / {items.length}</span><button type="button" className={styles.iconButton} disabled={index === items.length-1} onClick={() => move(1)} aria-label="다음 브리핑"><ChevronRight size={18}/></button></div><a href={item.href} className={styles.link}>AI 인용 현황 <ArrowRight size={13}/></a></footer>
  </div>
 </dialog>;
}

function Monitoring({data}:{data:OverviewData}) {
 const [opened,setOpened] = useState<number|null>(null);
 const stateText = {ready:'저장된 AI 브리핑이 없습니다.',running:'AI 인용을 확인하고 있습니다.',failed:'최근 AI 인용 확인에 실패했습니다.',not_configured:'AI 인용 확인이 아직 설정되지 않았습니다.',empty:'아직 AI 인용 확인 기록이 없습니다.'}[data.citationState];
 return <section className={styles.monitoring} aria-label="AI 브리핑 모니터링">
  <div className={styles.monitoringHeader}><h2><Sparkles size={15}/> AI 브리핑 모니터링</h2><p>{data.metrics.briefing === null ? '확인 후 브리핑이 표시됩니다' : `내 키워드 ${number(data.metrics.briefing)}건에서 AI 브리핑 포착${data.metrics.cited ? ` · 내 글 인용 ${number(data.metrics.cited)}건` : ''}`}</p><a href={data.citationHref} className={styles.link}>AI 인용 현황 <ArrowRight size={15}/></a></div>
  {data.monitoring.length ? <div className={styles.gallery}>{data.monitoring.map((item,index) => <button type="button" key={item.id} className={`${styles.briefingCard} ${item.cited ? styles.briefingCited : ''}`} aria-label={`${item.keyword || item.title} AI 브리핑 상세보기`} onClick={() => setOpened(index)}>
   <div className={styles.briefingPreview}><div className={styles.previewHeading}><Sparkles size={10}/> AI 브리핑 <span>저장된 브리핑</span></div>{item.media.some(media => safeUrl(media.thumbnail)) && <div className={styles.previewImages}>{item.media.filter(media => safeUrl(media.thumbnail)).slice(0,3).map((media,i) => <img key={`${media.thumbnail}-${i}`} src={safeUrl(media.thumbnail)} alt="" loading="lazy" referrerPolicy="no-referrer"/>)}</div>}<p>{plain(item.markdown) || item.references.map(reference => reference.title).join(' · ') || '상세 보기에서 확인하세요.'}</p></div>
   {item.cited && <span className={styles.galleryBadge}><Check size={10}/> 내 글 인용</span>}<span className={styles.cardCaption}>{item.keyword || item.title}</span>
  </button>)}</div> : <Empty href={data.connected ? data.citationHref : '/dashboard/settings'} action={data.connected ? 'AI 인용 현황' : '블로그 연결하기'}>{stateText}</Empty>}
  {opened !== null && <BriefingDialog items={data.monitoring} initial={opened} close={() => setOpened(null)}/>}
 </section>;
}

function GrowthChart({points}:{points:CitationPoint[]}) {
 const plot = useRef<HTMLDivElement>(null);
 const [width,setWidth] = useState(800);
 const [selected,setSelected] = useState<number|null>(null);
 const uid = useId().replace(/:/g,'');
 const readoutId = useId();
 useEffect(() => {
  if (!plot.current) return;
  const observer = new ResizeObserver(([entry]) => setWidth(Math.max(250,Math.round(entry.contentRect.width))));
  observer.observe(plot.current);
  return () => observer.disconnect();
 }, []);
 const start = points[0]?.measuredAt ?? 0, end = points.at(-1)?.measuredAt ?? start;
 const max = Math.max(1,...points.flatMap(point => [point.cited,point.exposed]));
 const step = Math.max(1,Math.ceil(max / 3));
 const upper = step * 3, left = 32, right = width-10, bottom = 190, top = 12;
 const x = (at:number) => start === end ? (left+right)/2 : left+(at-start)/(end-start)*(right-left);
 const y = (value:number) => bottom-value/upper*(bottom-top);
 const activeIndex = selected === null ? points.length-1 : Math.min(selected,points.length-1);
 const active = points[activeIndex];
 const series = [{key:'cited' as const,label:'AI 인용',color:'var(--overview-green)'},{key:'exposed' as const,label:'통합검색 노출',color:'var(--overview-red)'}];
 const tickIndexes = [...new Set([0,Math.floor((points.length-1)/2),points.length-1])].filter(index => index >= 0);
 return <div ref={plot} className={styles.plot}>
  {points.length ? <>
   <svg viewBox={`0 0 ${width} 220`} role="group" tabIndex={0} aria-label="AI 인용과 통합검색 노출 건수 추이. 좌우 방향키로 측정 기록을 선택하세요." aria-describedby={readoutId} className={styles.growthSvg} onKeyDown={event => {
    if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
     event.preventDefault();
     setSelected(event.key === 'Home' ? 0 : event.key === 'End' ? points.length-1 : Math.max(0,Math.min(points.length-1,activeIndex+(event.key === 'ArrowLeft' ? -1 : 1))));
    }
   }} onPointerMove={event => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const cursor = (event.clientX-bounds.left)/bounds.width*width;
    const nearest = points.reduce((best,point,index) => Math.abs(x(point.measuredAt)-cursor) < Math.abs(x(points[best].measuredAt)-cursor) ? index : best,0);
    setSelected(nearest);
   }}>
    <defs>{series.map(series => <linearGradient key={series.key} id={`${uid}-${series.key}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={series.color} stopOpacity=".28"/><stop offset="1" stopColor={series.color} stopOpacity=".02"/></linearGradient>)}</defs>
    {[0,step,step*2,upper].map(value => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="var(--overview-line)" strokeDasharray="2 4"/><text x={left-10} y={y(value)+4} textAnchor="end" fill="var(--overview-muted)" fontSize="10">{value}</text></g>)}
    {series.map(series => {const path = points.map((point,index) => `${index ? 'L' : 'M'}${x(point.measuredAt)},${y(point[series.key])}`).join(' ');return <g key={series.key}>{points.length > 1 && <><path d={`${path} L${x(end)},${bottom} L${x(start)},${bottom} Z`} fill={`url(#${uid}-${series.key})`}/><path d={path} fill="none" stroke={series.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/></>}{points.map((point,index) => <circle key={point.id} cx={x(point.measuredAt)} cy={y(point[series.key])} r={index === selected ? 4.5 : 3} fill="var(--overview-card)" stroke={series.color} strokeWidth="1.75"><title>{time(point.measuredAt)} · {series.label} {point[series.key]}건</title></circle>)}</g>;})}
    {selected !== null && active && <line x1={x(active.measuredAt)} x2={x(active.measuredAt)} y1={top} y2={bottom} stroke="var(--overview-muted)" strokeDasharray="3 4" opacity=".55"/>}
    {tickIndexes.map(index => <text key={index} x={x(points[index].measuredAt)} y="213" textAnchor={points.length === 1 ? 'middle' : index === 0 ? 'start' : index === points.length-1 ? 'end' : 'middle'} fill="var(--overview-muted)" fontSize="10">{date(points[index].measuredAt)}</text>)}
   </svg>
   <div className={styles.legend}>{series.map(series => <span key={series.key}><i style={{background:series.color}}/>{series.label}</span>)}</div>
   <p className={styles.readout} id={readoutId} aria-live="polite">{active && `${time(active.measuredAt)} · AI 인용 ${active.cited}건 · 통합검색 노출 ${active.exposed}건`}</p>
  </> : <Empty>이 기간에 측정된 기록이 없습니다.</Empty>}
 </div>;
}

function RankCard({card}:{card:DashboardRankCard}) {
 const history = [...card.history].sort((a,b) => a.at-b.at);
 const first = history[0]?.at ?? 0, last = history.at(-1)?.at ?? first;
 const best = Math.min(...history.map(point => point.rank)), worst = Math.max(...history.map(point => point.rank));
 const points = history.map(point => ({x:first === last ? 120 : 4+(point.at-first)/(last-first)*232,y:best === worst ? 28 : 7+(point.rank-best)/(worst-best)*42}));
 return <article className={styles.rankCard}><div className={styles.rankCardLabel}><h3>{card.label}</h3><span>{card.periodLabel}</span></div><div className={styles.rankValue}><strong>{number(card.rank)}<small>{card.rank === null ? '' : '위'}</small></strong>{card.delta !== null && <span className={card.delta > 0 ? styles.gain : card.delta < 0 ? styles.loss : styles.muted}>{card.delta > 0 ? '▲ ' : card.delta < 0 ? '▼ ' : '— '}{number(Math.abs(card.delta))}</span>}</div><p>{card.rank === null ? card.public ? '이 기간의 랭킹 기록이 없습니다' : '랭킹 공개 후 순위를 확인하세요' : `${number(card.participants)}명 중 · 상위 ${Math.max(1,Math.ceil(card.rank/Math.max(1,card.participants)*100))}%`}</p>{points.length > 1 ? <svg className={styles.sparkline} viewBox="0 0 240 56" role="img" aria-label={`${card.label} 순위 변화: ${history.map(point => `${date(point.at)} ${point.rank}위`).join(', ')}`}><polyline points={points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="var(--overview-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/></svg> : <div className={styles.sparklineEmpty}>{points.length === 1 ? '다음 기록부터 순위 변화를 보여드립니다' : '아직 순위 변화 기록이 없습니다'}</div>}</article>;
}

const changeLabels:Record<DashboardChange['kind'],string> = {citation_gained:'인용↑',citation_lost:'인용↓',exposure_gained:'노출↑',exposure_lost:'노출↓',rank:'순위',scan:'스캔'};

export default function DashboardOverview({data, diagnosis}:{data:OverviewData; diagnosis:DashboardVisualization}) {
 const [period,setPeriod] = useState<ChartPeriod>(30);
 const [feedPeriod,setFeedPeriod] = useState<ChartPeriod>(30);
 const [scope,setScope] = useState<'all'|'category'>('all');
 const selectedRanking = data.rankings.find(ranking => ranking.scope === scope) ?? data.rankings[0];
 const citationRate = data.metrics.checked === null || data.metrics.cited === null ? null : percentage(data.metrics.cited,data.metrics.checked);
 const exposureRate = data.metrics.checked === null || data.metrics.exposed === null ? null : percentage(data.metrics.exposed,data.metrics.checked);
 const points = inPeriod(data.citations,period,data.now).filter(point => point.checked > 0);
 const feedStart = feedPeriod === 'all' ? 0 : Math.floor((data.now+9*3600_000)/DAY)*DAY-9*3600_000-(feedPeriod-1)*DAY;
 const changes = data.changes.filter(change => change.at >= feedStart && change.at <= data.now).sort((a,b) => b.at-a.at);
 const heading = citationRate === null ? 'AI 인용과 검색 노출을 한눈에 확인하세요' : `AI 인용률 ${citationRate}% · ${data.metrics.cited ? `인용된 글 ${number(data.metrics.cited)}건을 확인하세요` : '내 블로그의 성장 흐름을 확인하세요'}`;
 const kpis = [
  {title:'AI 인용률',value:citationRate,unit:'%',description:citationRate === null ? '아직 확인된 글이 없습니다' : `${number(data.metrics.cited)} / ${number(data.metrics.checked)} 글 AI 인용`,href:data.citationHref,tone:styles.gain},
  {title:'통합검색 노출률',value:exposureRate,unit:'%',description:exposureRate === null ? '아직 확인된 글이 없습니다' : `${number(data.metrics.exposed)} / ${number(data.metrics.checked)} 글 노출 중`,href:data.citationHref,tone:styles.loss},
  {title:'재추천 키워드',value:data.metrics.revisit,unit:'건',description:data.metrics.revisit ? '다시 주목할 키워드를 확인하세요' : '재추천된 키워드가 없습니다',href:statusHref(data.recommendationHref,'revisit'),tone:''},
  {title:'선점기회 키워드',value:data.metrics.opportunity,unit:'건',description:data.metrics.opportunity ? '먼저 작성할 키워드를 확인하세요' : '지금은 선점기회 키워드가 없습니다',href:statusHref(data.recommendationHref,'opportunity'),tone:''},
 ];
 return <div data-naeo-live="dashboard-overview" className={styles.overview}>
  <header className={styles.intro}><p>블로그 운영 대시보드</p><h1>{heading}</h1></header>
  <Monitoring data={data}/>
  <section className={styles.kpis} aria-label="핵심 지표">{kpis.map(kpi => <a key={kpi.title} href={kpi.href} className={styles.kpi}><h2>{kpi.title}</h2><strong className={kpi.tone}>{number(kpi.value)}<small>{kpi.value === null ? '' : kpi.unit}</small></strong><p>{kpi.description}</p></a>)}</section>
  <section className={styles.panel} aria-label="블로그 성장 추세"><div className={styles.sectionHeader}><div><h2>블로그 성장 추세</h2><p>AI 인용과 통합검색 노출 흐름을 함께 봅니다</p></div><PeriodButtons value={period} onChange={setPeriod}/></div><GrowthChart key={period} points={points}/>{points.some(point => point.errors > 0) && <p className={styles.footnote}>확인에 실패한 글은 제외했습니다.</p>}</section>
  <section className={styles.panel} aria-label="AI 랭킹"><div className={styles.sectionHeader}><div><h2>AI 랭킹</h2><p>{selectedRanking?.scope !== 'category' ? '모든 블로그 중 내 순위' : `${selectedRanking.label || '같은 주제'} 블로그 중 내 순위`}</p></div><a className={styles.link} href="/ranking">랭킹 보기 <ArrowRight size={13}/></a></div><div className={styles.rankScopes} role="group" aria-label="랭킹 비교 범위">{data.rankings.map(ranking => <button type="button" key={ranking.scope} aria-pressed={selectedRanking?.scope === ranking.scope} onClick={() => setScope(ranking.scope)}>{ranking.label}</button>)}</div>{selectedRanking?.cards.length ? <div className={styles.rankGrid}>{selectedRanking.cards.map(card => <RankCard key={card.period} card={card}/>)}</div> : <Empty href="/dashboard/settings" action="공개 설정 확인">아직 랭킹 기록이 없습니다.</Empty>}<p className={styles.footnote}>이 서비스에 공개 등록한 블로그의 저장된 진단 점수로 산정한 순위입니다.</p></section>
  <section className={styles.panel} aria-label="오늘 할 일"><div className={styles.sectionHeader}><div><h2>오늘 할 일</h2><p>차트로 상태를 보고, 여기서 바로 다음 행동을 고릅니다</p></div></div><div className={styles.taskGrid}>
   <section className={styles.taskColumn}><h3>AI 인용된 글 {data.metrics.cited === null ? '' : `${number(data.metrics.cited)}건 `}확인</h3><p>인용 위치와 출처 유형을 살펴보세요.</p>{data.citedPosts.length ? <div className={styles.taskList}>{data.citedPosts.map(post => <a className={styles.postRow} key={post.id} href={post.href}><div><h4>{post.title}</h4><p>키워드: {post.keyword}</p><div className={styles.rowMetadata}>{post.textRank !== null && <span className={styles.gain}>본문 {post.textRank}위</span>}{post.imageRank !== null && <span className={styles.gain}>이미지 {post.imageRank}위</span>}<span>검색량 {number(post.volume)}</span><span>포화도 {number(post.saturation)}</span></div></div><ChevronRight size={17}/></a>)}</div> : <Empty href={data.citationHref} action="AI 인용 현황">{data.metrics.cited === null ? '인용 확인 후 글을 표시합니다.' : '아직 인용된 글이 없습니다.'}</Empty>}</section>
   <section className={styles.taskColumn}><h3>추천 키워드 {number(data.metrics.recommendations)}건 확인</h3><p>신규·선점기회·재추천 키워드를 확인하세요.</p>{data.recommendations.length ? <div className={styles.recommendationGrid}>{data.recommendations.map(keyword => <a key={keyword.id} className={styles.keywordRow} href={keyword.href}><div><h4>{keyword.phrase}</h4><span className={styles.signal}>{signals[keyword.signal]}</span><ExternalLink size={12}/></div><p>검색량 <b>{number(keyword.volume)}</b><span>포화도 {number(keyword.saturation)}</span></p></a>)}</div> : <Empty href={data.recommendationHref} action="키워드 추천">아직 추천 키워드가 없습니다.</Empty>}</section>
  </div></section>
  <section className={styles.panel} aria-label="변화 피드"><div className={styles.sectionHeader}><div><h2>변화 피드</h2><p>{feedPeriod === 'all' ? '전체' : `최근 ${feedPeriod}일`} 변화를 시간순으로 보여줍니다</p></div><PeriodButtons value={feedPeriod} onChange={setFeedPeriod} feed/></div>{changes.length ? <ul className={styles.feed}>{changes.map(change => <li key={change.id}><a href={safeUrl(change.href)}><span className={`${styles.changeBadge} ${change.kind.endsWith('_gained') ? styles.badgeGain : change.kind.endsWith('_lost') ? styles.badgeLoss : change.kind === 'rank' ? styles.badgeRank : styles.badgeScan}`}>{changeLabels[change.kind]}</span><div><h3>{change.title}</h3>{change.description && <p>{change.description}</p>}</div><time dateTime={new Date(change.at).toISOString()} title={time(change.at)}>{relativeTime(change.at,data.now)}</time></a></li>)}</ul> : <Empty>선택한 기간에 기록된 변화가 없습니다.</Empty>}</section>
  <details className={styles.diagnosis}><summary>블로그 진단 상세</summary><div><DashboardCharts data={diagnosis}/></div></details>
 </div>;
}
