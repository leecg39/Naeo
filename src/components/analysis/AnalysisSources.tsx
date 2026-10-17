import {kstDate} from '@/lib/kst-time';
import type {MateSource} from '@/server/mate/mate';
import styles from '@/components/content/MateReportView.module.css';

/** The same stored public evidence appears in the home report and the dashboard. */
export default function AnalysisSources({source,expanded=true}:{source:MateSource;expanded?:boolean}){
 return <section className={styles.source} aria-label="분석한 공개 글">
  <div className={styles.heading}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title||source.url} ↗</a><span>네이버 RSS 실제 수집</span></div>
  <details open={expanded}><summary>수집한 최근 글 {source.posts.length}개 · 원문과 분석 근거 보기</summary>
   <ul>{source.posts.map(post=><li key={post.url}>
    <a href={post.url} target="_blank" rel="noopener noreferrer">{post.title||'제목 없는 글'} ↗</a>
    <p>{post.publishedAt===null?'발행일 확인 불가':kstDate(post.publishedAt)} · {post.category||'분류 없음'} · 제목 {[...post.title.trim()].length}자 · 태그 {post.tags.length}개</p>
   </li>)}</ul>
  </details>
  <p>전체 게시물 수가 아닌 RSS에서 읽은 글 수입니다. 최근 글 목록은 최대 30개까지 표시합니다.</p>
 </section>;
}
