'use client';

import {useState} from 'react';
import type {DiscoveredRecommendation} from '@/lib/recommendation-feed';
import {writingRecommendation} from '@/lib/writing-recommendation';
import styles from './RecommendationWorkspace.module.css';

export type StartRecommendedDraft=(item:DiscoveredRecommendation,titleIndex:number)=>void;

export default function WritingSuggestion({item,busy,start}:{item:DiscoveredRecommendation;busy:boolean;start:StartRecommendedDraft}){
 const [titleIndex,setTitleIndex]=useState(0);
 const plan=writingRecommendation(item);
 return <article className={styles.writingSuggestion} aria-label={`${item.phrase} 글쓰기 추천`}>
  <div className={styles.writingMeta}><span>{plan.format}</span><small>{item.phrase}</small></div>
  <h3>{plan.titles[titleIndex]}</h3>
  <p>{item.reason}</p>
  <label>제목 후보<select value={titleIndex} disabled={busy} onChange={event=>setTitleIndex(Number(event.target.value))}>{plan.titles.map((title,index)=><option key={title} value={index}>{title}</option>)}</select></label>
  <details><summary>추천 목차 보기 · {plan.outline.length}개</summary><p className={styles.caption}>추천 독자: {plan.audience}</p><ol>{plan.outline.map(section=><li key={section.heading}><strong>{section.heading}</strong><p>{section.guidance}</p></li>)}</ol>{item.sourcePost&&<a href={item.sourcePost.url} target="_blank" rel="noopener noreferrer">분석한 내 글 보기 ↗</a>}</details>
  <button type="button" className={styles.primary} disabled={busy||item.written} onClick={()=>start(item,titleIndex)}>이 구성으로 초안 열기 ↗</button>
  <small className={styles.caption}>제목·목차를 저장합니다. 이미 만든 초안은 이어서 열어요.</small>
 </article>;
}
