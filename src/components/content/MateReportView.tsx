'use client';
import {kstDate,kstDateTime} from '@/lib/kst-time';
import {useState} from 'react';
import type {MateReport} from '@/server/mate/mate';
import AnalysisSummary from '@/components/analysis/AnalysisSummary';
import styles from './MateReportView.module.css';

const muted={fontSize:13,color:'var(--muted, #a3a3a3)'} as const;
const fmt=(ms:number)=>kstDateTime(ms);

/** 무료 진단 리포트(실제 RSS 분석 결과). 모든 글자는 텍스트로만 렌더링한다. */
export default function MateReportView({report,onContinue}:{report:MateReport;onContinue:()=>void}){
 const [copied,setCopied]=useState('');
 const shareUrl=typeof window==='undefined'?'':`${window.location.origin}/mate/s?r=${report.token}`;
 const copy=async()=>{try{await navigator.clipboard.writeText(shareUrl);setCopied('공유 링크를 복사했습니다.');}catch{setCopied('복사하지 못했습니다. 주소를 직접 복사해주세요.');}};
 const r=report.report;
 return <div>
  <p style={{...muted,marginBottom:12}}>{report.naverId} · 공개 글 {report.postCount}개 분석 · {fmt(report.createdAt)}</p>
  {report.source&&<section className={styles.source} aria-label="분석한 공개 글">
   <div className={styles.heading}><a href={report.source.url} target="_blank" rel="noopener noreferrer">{report.source.title||report.naverId} ↗</a><span>네이버 RSS 실제 수집</span></div>
   <details open><summary>수집한 최근 글 {report.source.posts.length}개 · 원문과 분석 근거 보기</summary>
    <ul>{report.source.posts.map(post=><li key={post.url}>
     <a href={post.url} target="_blank" rel="noopener noreferrer">{post.title||'제목 없는 글'} ↗</a>
     <p>{post.publishedAt===null?'발행일 확인 불가':kstDate(post.publishedAt)} · {post.category||'분류 없음'} · 제목 {[...post.title.trim()].length}자 · 태그 {post.tags.length}개</p>
    </li>)}</ul>
   </details>
   <p>전체 게시물 수가 아닌 RSS에서 읽은 글 수입니다. 최근 글 목록은 최대 30개까지 표시합니다.</p>
  </section>}
  <AnalysisSummary report={r} postCount={report.postCount}/>
  {r.actions.length>0&&<div style={{margin:'16px 0'}}><strong style={{display:'block',marginBottom:6}}>다음에 할 일</strong><ul style={{margin:0,paddingLeft:18}}>{r.actions.map(a=><li key={a.criterion} style={{fontSize:14,marginBottom:4}}>{a.title}</li>)}</ul></div>}
  {report.saved===false&&<p style={{...muted,margin:'12px 0'}}>로그인한 상태에서 진단하면 이 리포트가 내 진단 기록에 저장됩니다.</p>}
  <p style={{...muted,margin:'12px 0'}}>AI 브리핑 인용 여부는 확인 공급자가 설정되지 않아 이번 리포트에 포함하지 않았습니다.</p>
  <p style={{...muted,marginBottom:16}}>{r.disclosure}</p>
  <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
   <button className="naeo-button" type="button" onClick={onContinue}>{report.saved?'대시보드에서 분석 보기':'대시보드로 이동'}</button>
   <button className="naeo-button" type="button" onClick={()=>void copy()}>공유 링크 복사</button>
  </div>
  <p role="status" aria-live="polite" style={{...muted,marginTop:8}}>{copied||`공유 링크는 ${fmt(report.expiresAt)}까지 열 수 있습니다.`}</p>
 </div>;
}
