import React from "react";
import { api, ApiError } from "@/lib/api-client";
import { type BehaviorTools, type InstallBehavior, text } from "@/lib/behavior";

type Cleanup = () => void;
type AiRow = {
  element: HTMLElement; index: number; resultId: string; title: string; keyword: string; link: string; category: string;
  checkedAt: number; publishedAt: number; volume: number; saturation: number; exposed: boolean; briefing: boolean; recommended: boolean;
  textCited: boolean; imageCited: boolean;
};
type KeywordMetricDetail = {
  keyword: string; pcVolume: number | null; mobileVolume: number | null; total: number | null;
  compIdx: "낮음" | "보통" | "높음" | null; documentCount: number | null; saturation: number | null;
};
type Source = { title: string; link: string; source?: string; platform?: string; thumbnail?: string; mine: boolean; samePost: boolean };
type CitationDetailData = {
  id: string; postId: string; title: string; url: string; category: string; publishedAt: number | null; checkedAt: number;
  keyword: string; keywordSource: "member" | "tag" | "title"; keywordVersion: number; status: "checked" | "error";
  briefing: boolean; exposed: boolean; textRank: number | null; imageRank: number | null; volume: number | null; saturation: number | null;
  textCitedCount?: number; samePostCitedCount?: number;
  mainKeywordMetric?: KeywordMetricDetail; subKeywords?: KeywordMetricDetail[]; relatedKeywords?: KeywordMetricDetail[];
  briefingDetail: { markdown: string; questions: string[]; references: (Source & { index: number; snippet: string })[]; media: (Source & { position: number })[] } | null;
  exposure: { section: string; position: number } | null; error: { code: string; message: string } | null;
};
type CitationRunStatus = { id: string; state: "queued" | "running" | "succeeded" | "failed" | "canceled"; progress: number; checked: number; errorMessage: string | null };
const KEYWORD_SOURCE = { member: "직접 지정", tag: "첫 태그", title: "제목" } as const;
const elements = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector));

/** Keep the captured React-owned elements intact; only change attributes and text nodes. */
function mutations() {
  const undo: Cleanup[] = [];
  const attributes = new WeakMap<Element, Set<string>>();
  const texts = new WeakSet<Node>();
  function attr(node: Element | null, name: string, value: string | null) {
    if (!node) return;
    let names = attributes.get(node);
    if (!names) { names = new Set(); attributes.set(node, names); }
    if (!names.has(name)) {
      const original = node.getAttribute(name);
      undo.push(() => original === null ? node.removeAttribute(name) : node.setAttribute(name, original));
      names.add(name);
    }
    if (value === null) node.removeAttribute(name); else node.setAttribute(name, value);
  }
  function content(node: Element | null, value: string) {
    if (!node) return;
    const child = Array.from(node.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
    if (!child) return;
    if (!texts.has(child)) {
      const original = child.textContent;
      undo.push(() => { child.textContent = original; });
      texts.add(child);
    }
    child.textContent = value;
  }
  return { attr, content, undo, cleanup: () => undo.reverse().forEach(fn => fn()) };
}

function selectGroup(group: HTMLElement[], chosen: HTMLElement, mutate: ReturnType<typeof mutations>, active?: string, inactive?: string) {
  const selectedClass = active || group.find(el => el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-pressed") === "true")?.className;
  const otherClass = inactive || group.find(el => el.getAttribute("aria-selected") === "false" || el.getAttribute("aria-pressed") === "false")?.className;
  group.forEach(el => {
    const selected = el === chosen;
    mutate.attr(el, el.getAttribute("role") === "tab" ? "aria-selected" : "aria-pressed", String(selected));
    if (selectedClass && otherClass) mutate.attr(el, "class", selected ? selectedClass : otherClass);
  });
}

function statusElement(parent: HTMLElement | null, cleanup: Cleanup[]) {
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.style.cssText = "font-size:12px;color:#A3A3A3;margin:12px 0 0;display:none";
  parent?.append(status);
  cleanup.push(() => status.remove());
  return (message: string) => { status.textContent = message; status.style.display = "block"; };
}

function copyLink(link: string, tools: BehaviorTools) {
  navigator.clipboard?.writeText(link).then(() => tools.toast("링크를 복사했습니다.")).catch(() => tools.toast("브라우저에서 링크를 직접 복사해 주세요."));
}

const kstDay = (ms: number) => { const d = new Date(ms + 9 * 3600_000); return `${d.getUTCFullYear()}. ${d.getUTCMonth() + 1}. ${d.getUTCDate()}.`; };
const fmtNum = (n: number | null | undefined) => n === null || n === undefined ? "-" : n.toLocaleString("ko-KR");
const fmtSat = (s: number | null | undefined) => s === null || s === undefined ? "-" : `${(s * 100).toFixed(1)}%`;
const satColor = (s: number | null | undefined) => s !== null && s !== undefined && s < 0.5 ? "#03c75a" : "inherit";
const compColor = (c: KeywordMetricDetail["compIdx"]) => c === "낮음" ? "#4ade80" : c === "보통" ? "#facc15" : c === "높음" ? "#f87171" : "#94a3b8";
// 서버가 http(s)만 저장하지만 화면에서도 한 번 더 확인한다.
const safeHref = (link: string) => /^https?:\/\//i.test(link) ? link : undefined;
const sourceLink = (s: Source) => <a href={safeHref(s.link)} target="_blank" rel="noopener noreferrer nofollow" style={{ color: "inherit", fontWeight: 600, textDecoration: "none", overflowWrap: "anywhere" }}>{s.title || s.link}</a>;

const cardBoxStyle: React.CSSProperties = {
  padding: "14px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)",
};
const thStyle: React.CSSProperties = {
  padding: "8px 10px", fontSize: 12, fontWeight: 600, color: "#94a3b8", textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.08)", whiteSpace: "nowrap",
};
const tdStyle: React.CSSProperties = {
  padding: "9px 10px", fontSize: 13, textAlign: "right", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap",
};

function CompChip({ level }: { level: KeywordMetricDetail["compIdx"] }) {
  if (!level) return <span style={{ color: "#94a3b8" }}>-</span>;
  const color = compColor(level);
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, color, background: `${color}1f` }}>{level}</span>;
}

function SourceChip({ source, citedCount }: { source: Source; citedCount?: number }) {
  if (!source.mine) return null;
  const label = source.samePost
    ? citedCount && citedCount > 0 ? `현재 포스팅 (${citedCount}회 인용)` : "현재 포스팅"
    : citedCount && citedCount > 0 ? `내 블로그 (${citedCount}회 인용)` : "내 블로그";
  return <span style={{
    flexShrink: 0, display: "inline-flex", alignItems: "center", padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700,
    background: source.samePost ? "#03c75a" : "rgba(3,199,90,0.14)", color: source.samePost ? "#fff" : "#03c75a",
    border: source.samePost ? "none" : "1px solid rgba(3,199,90,0.4)",
  }}>{label}</span>;
}

/** REA `0vikp-jk811qz.js` (module 887197 `P`) 구조화 마크다운 + 표 + 인용 문장 하이라이트 렌더러 */
function BriefingMarkdown({ markdown, references, textRank }: { markdown: string; references: (Source & { index: number; snippet: string })[]; textRank: number | null }) {
  const myRefs = new Map(references.filter(r => r.mine).map(r => [r.index, r]));
  const fallbackRef = textRank !== null ? references.find(r => r.mine) ?? null : null;
  const lines = (markdown || "").split(/\r?\n/);
  const elementsOut: React.ReactNode[] = [];
  let listItems: string[] = [];
  let tableRows: string[] = [];
  let highlightedOnce = false;

  const renderSegment = (line: string, keyPrefix: string) => {
    const matchIndices = [...line.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]));
    const citedRef = matchIndices.map(i => myRefs.get(i)).find(Boolean) ?? (!highlightedOnce && fallbackRef && myRefs.size === 0 ? fallbackRef : undefined);
    if (!citedRef) return <span>{line}</span>;
    highlightedOnce = true;
    return <span style={{
      display: "inline-block", background: "rgba(3,199,90,0.12)", borderLeft: "3px solid #03c75a",
      padding: "4px 10px", borderRadius: "0 6px 6px 0", margin: "2px 0", lineHeight: 1.7,
    }}>
      <span style={{ color: "#4ade80", fontWeight: 600 }}>{line}</span>
      <a href={safeHref(citedRef.link)} target="_blank" rel="noopener noreferrer nofollow" style={{
        display: "inline-flex", alignItems: "center", marginLeft: 8, padding: "1px 8px", borderRadius: 999,
        fontSize: 11, fontWeight: 700, textDecoration: "none",
        background: citedRef.samePost ? "#03c75a" : "rgba(3,199,90,0.2)", color: citedRef.samePost ? "#fff" : "#4ade80",
      }}>{citedRef.samePost ? "현재 포스팅" : "내 블로그"}</a>
    </span>;
  };

  const flushList = (key: string) => {
    if (!listItems.length) return;
    const items = listItems; listItems = [];
    elementsOut.push(<ul key={key} style={{ margin: "0 0 12px", paddingLeft: 20, display: "grid", gap: 6 }}>{items.map((item, idx) => <li key={`${key}-${idx}`} style={{ fontSize: 14, lineHeight: 1.65 }}>{renderSegment(item, `${key}-${idx}`)}</li>)}</ul>);
  };

  const flushTable = (key: string) => {
    if (!tableRows.length) return;
    const raw = tableRows; tableRows = [];
    const parsed = raw.filter(r => !/^\|[\s\-:|]+\|$/.test(r.trim())).map(r => r.replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
    if (!parsed.length) return;
    const [head, ...body] = parsed;
    elementsOut.push(<div key={key} style={{ overflowX: "auto", margin: "8px 0 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead><tr style={{ background: "rgba(255,255,255,0.06)" }}>{head.map((h, i) => <th key={i} style={{ ...thStyle, textAlign: "left" }}>{h}</th>)}</tr></thead>
        <tbody>{body.map((row, rIdx) => <tr key={rIdx}>{row.map((cell, cIdx) => <td key={cIdx} style={{ ...tdStyle, textAlign: "left", whiteSpace: "normal" }}>{renderSegment(cell, `${key}-${rIdx}-${cIdx}`)}</td>)}</tr>)}</tbody>
      </table>
    </div>);
  };

  lines.forEach((raw, idx) => {
    const trimmed = raw.trim();
    if (!trimmed) { flushTable(`tbl-${idx}`); flushList(`lst-${idx}`); return; }
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) { flushList(`pre-tbl-${idx}`); tableRows.push(trimmed); return; }
    flushTable(`tbl-${idx}`);
    if (trimmed.startsWith("•") || trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      listItems.push(trimmed.replace(/^[•\-*]\s*/, ""));
      return;
    }
    flushList(`lst-${idx}`);
    if (trimmed.startsWith("# ")) {
      elementsOut.push(<h5 key={`h-${idx}`} style={{ margin: "14px 0 6px", fontSize: 15, fontWeight: 800 }}>{renderSegment(trimmed.slice(2), `h-${idx}`)}</h5>);
      return;
    }
    elementsOut.push(<p key={`p-${idx}`} style={{ margin: "0 0 10px", fontSize: 14, lineHeight: 1.7, overflowWrap: "anywhere" }}>{renderSegment(trimmed, `p-${idx}`)}</p>);
  });
  flushTable("final-tbl");
  flushList("final-lst");
  return <>{elementsOut.length ? elementsOut : <p style={{ margin: 0, color: "#94a3b8" }}>(본문 없음)</p>}</>;
}

/** 저장한 AI 브리핑 근거를 보여주고, 열람 기록(튜토리얼 조건)을 남긴다. 대표 키워드를 고치면 다음 확인부터 쓴다. */
function CitationDetail({ id, tools }: { id: string; tools: BehaviorTools }) {
  const [detail, setDetail] = React.useState<CitationDetailData | null>(null);
  const [error, setError] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [zoomCapture, setZoomCapture] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    api<CitationDetailData>(`/api/citations/results/${id}`).then(data => {
      if (!live) return;
      setDetail(data); setKeyword(data.keyword);
      void api(`/api/citations/results/${id}/viewed`, { method: "POST" }).catch(() => undefined);
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : "상세를 불러오지 못했습니다."); });
    return () => { live = false; };
  }, [id]);

  if (error) return <p role="alert">{error}</p>;
  if (!detail) return <p role="status">AI 인용 근거를 불러오는 중…</p>;

  const save = async (remove: boolean) => {
    setSaving(true); setNotice("");
    try {
      const next = await api<{ keyword: string; source: CitationDetailData["keywordSource"]; version: number } | null>(
        `/api/citations/keywords/${detail.postId}`,
        remove ? { method: "DELETE", body: { version: detail.keywordVersion } } : { method: "PUT", body: { keyword, version: detail.keywordVersion } }
      );
      setDetail({ ...detail, keyword: next?.keyword ?? keyword, keywordSource: next?.source ?? detail.keywordSource, keywordVersion: next?.version ?? 0 });
      if (next) setKeyword(next.keyword);
      setNotice(remove ? "자동 대표 키워드로 되돌렸습니다. 다음 확인부터 적용됩니다." : "대표 키워드를 저장했습니다. 다음 확인부터 이 키워드로 확인합니다.");
    } catch (e) { setNotice(e instanceof Error ? e.message : "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };

  const b = detail.briefingDetail;
  const mainMetric: KeywordMetricDetail = detail.mainKeywordMetric ?? {
    keyword: detail.keyword, pcVolume: null, mobileVolume: null, total: detail.volume, compIdx: null, documentCount: null, saturation: detail.saturation,
  };
  const subKeywords = detail.subKeywords ?? [];
  const relatedKeywords = detail.relatedKeywords ?? [];
  const textCitedCount = detail.textCitedCount ?? (b ? b.references.filter(r => r.mine).length : 0);
  const otherBlogPostCited = b ? b.references.find(r => r.mine && !r.samePost) : undefined;
  const samePostCited = b ? b.references.some(r => r.samePost) || b.media.some(m => m.samePost) : false;

  return <div style={{ display: "grid", gap: 18 }}>
    {/* 상단 포스트 제목 및 포스팅 보기 액션 바 */}
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ minWidth: 0, flex: "1 1 280px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 4, fontSize: 12, color: "#94a3b8" }}>
          {detail.category && <span style={{ color: "#03c75a", fontWeight: 700 }}>{detail.category}</span>}
          <span>확인일 {kstDay(detail.checkedAt)} · 발행일 {detail.publishedAt ? kstDay(detail.publishedAt) : "-"}</span>
        </div>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, lineHeight: 1.45, overflowWrap: "anywhere" }}>{detail.title || "(제목 없음)"}</h3>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <a className="naeo-button" href={safeHref(detail.url)} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, padding: "6px 12px" }}>
          포스팅 보기
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 3h7v7m0-7L10 14M5 5h6v2H7v10h10v-4h2v6H5V5z" fill="currentColor" /></svg>
        </a>
        <button type="button" className="naeo-button secondary" style={{ fontSize: 13, padding: "6px 12px" }} onClick={() => copyLink(detail.url, tools)}>링크 복사</button>
      </div>
    </div>

    {/* 상단: 메인 키워드 / 서브 키워드 / 연관 검색어 + AI 브리핑 캡쳐 미리보기 */}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "stretch" }}>
      <div style={{ flex: "1 1 480px", minWidth: 0, display: "grid", gap: 12 }}>
        {/* 메인 키워드 카드 */}
        <section style={cardBoxStyle} aria-label="메인 키워드 지표">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: "rgba(3,199,90,0.14)", color: "#03c75a" }}>메인 키워드</span>
              <strong style={{ fontSize: 15 }}>{detail.keyword}</strong>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>({KEYWORD_SOURCE[detail.keywordSource]})</span>
            </div>
            <a href={`https://search.naver.com/search.naver?query=${encodeURIComponent(detail.keyword)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#03c75a", textDecoration: "none", fontWeight: 600 }}>네이버 검색 &gt;</a>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>PC</th>
                  <th style={thStyle}>Mo</th>
                  <th style={thStyle}>전체</th>
                  <th style={{ ...thStyle, textAlign: "center" }} title="네이버 검색광고 기준 키워드 경쟁 정도입니다.">경쟁강도</th>
                  <th style={thStyle} title="해당 키워드를 포함하는 네이버 블로그 총 문서(포스팅) 수입니다.">문서</th>
                  <th style={thStyle} title="월간 검색량 대비 블로그 문서 수 비율입니다.">포화</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={tdStyle}>{fmtNum(mainMetric.pcVolume)}</td>
                  <td style={tdStyle}>{fmtNum(mainMetric.mobileVolume)}</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{fmtNum(mainMetric.total)}</td>
                  <td style={{ ...tdStyle, textAlign: "center" }}><CompChip level={mainMetric.compIdx} /></td>
                  <td style={tdStyle}>{fmtNum(mainMetric.documentCount)}</td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: satColor(mainMetric.saturation) }}>{fmtSat(mainMetric.saturation)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* 서브 키워드 카드 */}
        {subKeywords.length > 0 && <section style={cardBoxStyle} aria-label="서브 키워드 지표">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: "rgba(148,163,184,0.16)", color: "#cbd5e1" }}>서브 키워드</span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>{subKeywords.length}개</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: "left" }}>키워드</th>
                  <th style={thStyle}>PC</th>
                  <th style={thStyle}>Mo</th>
                  <th style={thStyle}>전체</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>경쟁강도</th>
                  <th style={thStyle}>문서</th>
                  <th style={thStyle}>포화</th>
                </tr>
              </thead>
              <tbody>
                {subKeywords.map(sk => <tr key={sk.keyword}>
                  <td style={{ ...tdStyle, textAlign: "left", fontWeight: 600 }}>{sk.keyword}</td>
                  <td style={tdStyle}>{fmtNum(sk.pcVolume)}</td>
                  <td style={tdStyle}>{fmtNum(sk.mobileVolume)}</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{fmtNum(sk.total)}</td>
                  <td style={{ ...tdStyle, textAlign: "center" }}><CompChip level={sk.compIdx} /></td>
                  <td style={tdStyle}>{fmtNum(sk.documentCount)}</td>
                  <td style={{ ...tdStyle, fontWeight: 700, color: satColor(sk.saturation) }}>{fmtSat(sk.saturation)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </section>}

        {/* 연관 검색어 (Top 10) 카드 */}
        <section style={cardBoxStyle} aria-label="연관 검색어">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: "rgba(148,163,184,0.16)", color: "#cbd5e1" }}>
              연관 검색어 ({relatedKeywords.length > 0 && relatedKeywords.length < 10 ? "10개 미만" : "Top 10"})
            </span>
          </div>
          {relatedKeywords.length > 0 ? <div style={{ overflowX: "auto", maxHeight: 200 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: "left" }}>추천 키워드</th>
                  <th style={thStyle}>PC</th>
                  <th style={thStyle}>Mo</th>
                  <th style={thStyle}>전체</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>경쟁강도</th>
                </tr>
              </thead>
              <tbody>
                {relatedKeywords.map(rk => <tr key={rk.keyword}>
                  <td style={{ ...tdStyle, textAlign: "left", fontWeight: 600 }}>{rk.keyword}</td>
                  <td style={tdStyle}>{fmtNum(rk.pcVolume)}</td>
                  <td style={tdStyle}>{fmtNum(rk.mobileVolume)}</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{fmtNum(rk.total)}</td>
                  <td style={{ ...tdStyle, textAlign: "center" }}><CompChip level={rk.compIdx} /></td>
                </tr>)}
              </tbody>
            </table>
          </div> : <div style={{ padding: "18px 12px", textAlign: "center", borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)" }}>
            <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>키워드 검색량이 적어 연관검색어가 없습니다.</p>
          </div>}
        </section>
      </div>

      {/* 우측 AI 브리핑 캡쳐 미리보기 박스 (브리핑 존재 시) */}
      {b && <div style={{ flex: "0 0 210px", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#03c75a" }}>AI 브리핑 요약</span>
            <span style={{ fontSize: 10, color: "#94a3b8" }}>출처 {b.references.length}건</span>
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "#cbd5e1", display: "-webkit-box", WebkitLineClamp: 6, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {b.markdown || "(본문 없음)"}
          </p>
        </div>
        <button type="button" onClick={() => setZoomCapture(v => !v)} style={{
          marginTop: 10, width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(0,0,0,0.45)", color: "#e2e8f0", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}>{zoomCapture ? "미리보기 접기" : "클릭하여 전체보기"}</button>
      </div>}
    </div>

    {zoomCapture && b && <div style={{ padding: 16, borderRadius: 10, border: "1px solid rgba(3,199,90,0.35)", background: "rgba(3,199,90,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <strong style={{ fontSize: 13, color: "#03c75a" }}>저장된 AI 브리핑 전체 미리보기 ({detail.keyword})</strong>
        <button type="button" className="naeo-button secondary" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setZoomCapture(false)}>닫기</button>
      </div>
      <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.7 }}>{b.markdown}</p>
    </div>}

    {detail.error && <p role="alert" style={{ margin: 0, color: "#e05a52" }}>{detail.error.message}</p>}

    {/* 대표 키워드 수정 폼 */}
    <form onSubmit={event => { event.preventDefault(); void save(false); }} style={{ ...cardBoxStyle, display: "grid", gap: 8 }}>
      <label htmlFor={`citation-keyword-${detail.id}`} style={{ fontSize: 13, fontWeight: 700 }}>대표 키워드 수정</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input id={`citation-keyword-${detail.id}`} className="naeo-field" style={{ flex: "1 1 200px", width: "auto" }} value={keyword} maxLength={60} onChange={event => setKeyword(event.target.value)} disabled={saving} />
        <button type="submit" className="naeo-button" disabled={saving || keyword.trim().length < 2}>저장</button>
        {detail.keywordSource === "member" && <button type="button" className="naeo-button secondary" disabled={saving} onClick={() => void save(true)}>자동으로 되돌리기</button>}
      </div>
      {notice && <p role="status" style={{ margin: 0, fontSize: 13, color: "#a3a3a3" }}>{notice}</p>}
    </form>

    {/* 중단: AI 브리핑 본문 또는 미발견 안내 */}
    {b ? <>
      <section style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", overflow: "hidden", background: "rgba(255,255,255,0.02)" }}>
        {!samePostCited && otherBlogPostCited && <div style={{
          padding: "10px 16px", background: "rgba(3,199,90,0.08)", borderBottom: "1px solid rgba(3,199,90,0.2)",
          display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 13,
        }}>
          <span style={{ color: "#4ade80", fontWeight: 600 }}>현재 포스팅이 아닌 다른 포스팅이 인용되었습니다.</span>
          <a href={safeHref(otherBlogPostCited.link)} target="_blank" rel="noopener noreferrer nofollow" style={{ color: "#03c75a", fontWeight: 700, textDecoration: "underline" }}>
            {otherBlogPostCited.title || "인용된 내 블로그 글 보기"}
          </a>
        </div>}
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)",
          display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8,
        }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>AI 브리핑</h4>
            <span style={{
              padding: "3px 9px", borderRadius: 6, fontSize: 12, fontWeight: 700,
              background: detail.exposed ? "rgba(224,90,82,0.14)" : "rgba(148,163,184,0.14)",
              color: detail.exposed ? "#e05a52" : "#94a3b8",
            }}>{detail.exposed ? "통합검색 노출" : "통합검색 미노출"}</span>
            {detail.imageRank !== null && <span style={{ padding: "3px 9px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: "rgba(3,199,90,0.14)", color: "#03c75a" }}>
              썸네일 {detail.imageRank}위
            </span>}
            {detail.textRank !== null && <span style={{ padding: "3px 9px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: "rgba(3,199,90,0.14)", color: "#03c75a" }}>
              본문 {detail.textRank}위 · {Math.max(1, textCitedCount)}회
            </span>}
          </div>
          {detail.exposure && <span style={{ fontSize: 12, color: "#94a3b8" }}>{detail.exposure.section} {detail.exposure.position}번째 결과</span>}
        </div>
        <div style={{ padding: 16, maxHeight: 320, overflowY: "auto" }}>
          <BriefingMarkdown markdown={b.markdown} references={b.references} textRank={detail.textRank} />
        </div>
      </section>

      {/* 하단 1: 이미지 출처 */}
      <section style={cardBoxStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>이미지 출처 ({b.media.length})</h4>
          <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "rgba(148,163,184,0.16)", color: "#cbd5e1" }}>{b.media.length}</span>
        </div>
        {b.media.length ? <ol style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
          {b.media.map(m => <li key={`${m.position}-${m.link}`} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 8,
            border: m.mine ? "1px solid rgba(3,199,90,0.4)" : "1px solid rgba(255,255,255,0.08)",
            background: m.mine ? "rgba(3,199,90,0.06)" : "rgba(255,255,255,0.02)",
          }}>
            {m.thumbnail && /^https?:\/\//i.test(m.thumbnail) && <img src={m.thumbnail} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />}
            <span style={{
              width: 24, height: 24, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700, flexShrink: 0,
              background: m.mine ? "#03c75a" : "rgba(148,163,184,0.16)", color: m.mine ? "#fff" : "#94a3b8",
            }}>{m.position}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, lineHeight: 1.4 }}>{sourceLink(m)}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{m.platform || "네이버 블로그"}</div>
            </div>
            <SourceChip source={m} />
          </li>)}
        </ol> : <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>이미지 출처 없음</p>}
      </section>

      {/* 하단 2: 본문 출처 */}
      <section style={cardBoxStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>본문 출처 ({b.references.length})</h4>
          <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "rgba(148,163,184,0.16)", color: "#cbd5e1" }}>{b.references.length}</span>
        </div>
        {b.references.length ? <ol style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
          {b.references.map(r => <li key={`${r.index}-${r.link}`} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 8,
            border: r.mine ? "1px solid rgba(3,199,90,0.4)" : "1px solid rgba(255,255,255,0.08)",
            background: r.mine ? "rgba(3,199,90,0.06)" : "rgba(255,255,255,0.02)",
          }}>
            <span style={{
              width: 24, height: 24, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700, flexShrink: 0,
              background: r.mine ? "#03c75a" : "rgba(148,163,184,0.16)", color: r.mine ? "#fff" : "#94a3b8",
            }}>{r.index}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, lineHeight: 1.4 }}>{sourceLink(r)}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{[r.source, r.snippet].filter(Boolean).join(" · ") || "문장 출처"}</div>
            </div>
            <SourceChip source={r} citedCount={r.mine ? Math.max(1, textCitedCount) : undefined} />
          </li>)}
        </ol> : <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>출처 없음</p>}
      </section>

      {/* 하단 3: 관련 질문 */}
      <section style={cardBoxStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>관련 질문</h4>
          <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "rgba(148,163,184,0.16)", color: "#cbd5e1" }}>{b.questions.length}</span>
        </div>
        {b.questions.length ? <ul style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
          {b.questions.map(q => <li key={q} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px",
            borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)",
          }}>
            <a href={`/dashboard/write?keyword=${encodeURIComponent(q.slice(0, 60))}`} style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 500, textDecoration: "none", overflowWrap: "anywhere" }}>{q}</a>
            <a href={`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(q)}`} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: "#03c75a", textDecoration: "none" }}>검색 &gt;</a>
          </li>)}
        </ul> : <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>관련 질문 없음</p>}
      </section>
    </> : <section style={{ ...cardBoxStyle, padding: "28px 20px", textAlign: "center" }}>
      <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700, color: "#cbd5e1" }}>
        {detail.status === "error" ? "키워드 확인 실패" : "AI 브리핑 미발견"}
      </p>
      <p style={{ margin: 0, fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
        {detail.status === "error"
          ? "이 키워드는 확인하지 못했습니다. 다음 확인에서 다시 시도합니다."
          : "이 키워드에 대해서는 AI 브리핑이 아직 생성되지 않았거나, 사용자 환경(IP, 브라우저)에 따라 결과가 다를 수 있습니다."}
      </p>
    </section>}
  </div>;
}

const PERIOD_LABELS: Record<string, string> = {
  전체: "전체",
  "이번 주": "이번 주",
  "이번 달": "이번 달",
  "3개월": "최근 3개월",
};

function periodCutoff(label: string, referenceMs: number): number | null {
  if (label === "전체") return null;
  const now = new Date(referenceMs);
  if (label === "이번 주") {
    const d = new Date(now);
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (label === "이번 달") return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (label === "3개월") return referenceMs - 90 * 86_400_000;
  return null;
}

function installAi(root: HTMLElement, tools: BehaviorTools, mutate: ReturnType<typeof mutations>, cleanup: Cleanup[]) {
  const container = root.querySelector<HTMLElement>(".mui-uien4a");
  if (!container) return () => false;
  const rows: AiRow[] = Array.from(container.children).filter((el): el is HTMLElement => el instanceof HTMLElement && !!el.dataset.resultId).map((element, index) => ({
    element, index, resultId: element.dataset.resultId || "", title: text(element.querySelector("a")), keyword: element.dataset.keyword || "",
    link: element.querySelector<HTMLAnchorElement>("a")?.href || "", category: element.dataset.category || "미분류",
    checkedAt: Number(element.dataset.checkedAt) || 0, publishedAt: Number(element.dataset.publishedAt) || 0,
    volume: Number(element.dataset.volume ?? -1), saturation: Number(element.dataset.saturation ?? -1),
    exposed: element.dataset.exposed === "true", briefing: element.dataset.briefing === "true", recommended: element.dataset.cited === "true",
    textCited: element.dataset.textCited === "true", imageCited: element.dataset.imageCited === "true",
  }));
  cleanup.push(() => rows.forEach(row => container.append(row.element)));
  const requestedResult = new URLSearchParams(window.location.search).get("open");
  if (requestedResult && rows.some(row => row.resultId === requestedResult)) {
    const timer = setTimeout(() => tools.openDialog("AI 인용 상세", <CitationDetail id={requestedResult} tools={tools} />, true), 0);
    cleanup.push(() => clearTimeout(timer));
  }
  const filters = elements(root, ".mui-5vm3uw > button");
  const active = filters[0]?.className;
  const inactive = filters[1]?.className;
  const sorts = elements(root, ".mui-10egq61 [role='button']");
  const sortActive = sorts[0]?.className;
  const sortInactive = sorts[1]?.className;
  const referenceMs = rows.reduce((max, r) => Math.max(max, r.checkedAt, r.publishedAt), Date.now());
  let filter = 0;
  let sort = 0;
  let descending = true;
  let scope = "전체";
  const report = statusElement(container.parentElement, cleanup);
  const empty = document.createElement("p");
  empty.textContent = "조건에 맞는 글이 없습니다.";
  empty.style.cssText = "display:none;padding:48px 20px;text-align:center;color:#A3A3A3";
  container.append(empty);
  cleanup.push(() => empty.remove());
  // 지표가 없는 글(-1)은 정렬 방향과 관계없이 뒤에 둔다.
  const measured = (value: number, other: number) => value < 0 ? (other < 0 ? 0 : 1) : other < 0 ? -1 : null;
  const inScope = (row: AiRow) => {
    if (scope === "전체") return true;
    const cutoff = periodCutoff(scope, referenceMs);
    if (cutoff !== null) return (row.publishedAt || row.checkedAt) >= cutoff;
    return row.category === scope;
  };
  const apply = () => {
    if (!rows.length) return;
    const scoped = rows.filter(inScope);
    const exposedCount = scoped.filter(r => r.exposed).length;
    const briefingCount = scoped.filter(r => r.briefing).length;
    const citedCount = scoped.filter(r => r.recommended).length;
    const counts = [`전체 ${scoped.length}`, `통합검색 노출 ${exposedCount}`, `AI 브리핑 ${briefingCount}`, `AI 추천됨 ${citedCount}`];
    filters.forEach((btn, idx) => { if (counts[idx]) mutate.content(btn, counts[idx]); });
    const visible = scoped.filter(row => filter === 0 || filter === 1 && row.exposed || filter === 2 && row.briefing || filter === 3 && row.recommended);
    const accepted = new Set(visible);
    rows.forEach(row => mutate.attr(row.element, "style", accepted.has(row) ? null : "display:none"));
    visible.sort((a, b) => {
      const key = sort === 1 ? [a.volume, b.volume] : sort === 2 ? [a.saturation, b.saturation] : [a.publishedAt, b.publishedAt];
      const unknown = sort ? measured(key[0], key[1]) : null;
      if (unknown !== null) return unknown || a.index - b.index;
      return (descending ? -1 : 1) * (key[0] - key[1]) || a.index - b.index;
    }).forEach(row => container.insertBefore(row.element, empty));
    empty.style.display = visible.length ? "none" : "block";
    report(`${PERIOD_LABELS[scope] || scope} · ${visible.length}개 글 · ${["최신순", "검색량순", "포화도순"][sort]} ${descending ? "내림차순" : "오름차순"}`);
    mutate.attr(container, "aria-label", `${ scope } ${visible.length}개 글`);
  };
  let closeMenu: Cleanup | undefined;
  cleanup.push(() => closeMenu?.());
  const openScopeMenu = (combo: HTMLElement) => {
    closeMenu?.();
    const menu = document.createElement("div");
    menu.className = "naeo-panel";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", "기간 및 카테고리 필터");
    const rect = combo.getBoundingClientRect();
    menu.style.cssText = `position:fixed;z-index:1500;left:${rect.left}px;top:${rect.bottom + 5}px;min-width:${Math.max(rect.width, 140)}px;max-height:320px;overflow:auto;padding:6px;background:#222;border-radius:10px;box-shadow:0 8px 30px #0008`;
    mutate.attr(combo, "aria-expanded", "true");
    const close = () => { menu.remove(); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); mutate.attr(combo, "aria-expanded", "false"); closeMenu = undefined; };
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node) && !combo.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { close(); combo.focus(); } };
    const categories = [...new Set(rows.map(row => row.category))].filter(Boolean);
    const options = ["전체", "이번 주", "이번 달", "3개월", ...categories.filter(c => !["전체", "이번 주", "이번 달", "3개월"].includes(c))];
    options.forEach(label => {
      const option = document.createElement("button");
      option.type = "button"; option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(scope === label)); option.textContent = label;
      option.style.cssText = `display:block;width:100%;border:0;padding:10px 16px;text-align:left;border-radius:6px;cursor:pointer;color:inherit;background:${scope === label ? "#03c75a26" : "transparent"}`;
      option.addEventListener("click", () => { scope = label; mutate.content(combo, label); apply(); close(); combo.focus(); });
      menu.append(option);
    });
    document.body.append(menu); document.addEventListener("pointerdown", outside); document.addEventListener("keydown", key);
    closeMenu = close; menu.querySelector<HTMLButtonElement>("button[aria-selected='true']")?.focus();
  };
  // 인용 확인 실행: 서버가 넣어 준 data-citation-blog/run으로 작업을 만들고 상태를 폴링한다.
  const runButton = root.querySelector<HTMLButtonElement>("button[data-citation-blog]");
  const note = root.querySelector<HTMLElement>("[data-citation-note]");
  const timers: ReturnType<typeof setTimeout>[] = [];
  cleanup.push(() => timers.forEach(clearTimeout));
  let cancelButton: HTMLButtonElement | null = null;
  cleanup.push(() => cancelButton?.remove());
  const label = (value: string) => mutate.content(runButton, value);
  const busy = (on: boolean, runId?: string) => {
    mutate.attr(runButton, "aria-busy", on ? "true" : "false"); mutate.attr(runButton, "disabled", on ? "" : null);
    if (on && runId && !cancelButton && runButton) {
      cancelButton = document.createElement("button");
      cancelButton.type = "button"; cancelButton.className = "naeo-button secondary"; cancelButton.textContent = "확인 취소";
      cancelButton.addEventListener("click", () => {
        if (!cancelButton) return;
        cancelButton.disabled = true;
        api<CitationRunStatus>(`/api/citations/runs/${runId}/cancel`, { method: "POST" }).then(() => tools.toast("취소를 요청했습니다. 확인 중인 글까지만 처리합니다.")).catch(e => { if (cancelButton) cancelButton.disabled = false; tools.toast(e instanceof Error ? e.message : "취소하지 못했습니다."); });
      });
      runButton.insertAdjacentElement("afterend", cancelButton);
    }
    if (!on) { cancelButton?.remove(); cancelButton = null; }
  };
  const poll = (runId: string, round = 0) => {
    busy(true, runId);
    if (round >= 300) { busy(false); label("인용 다시 확인"); tools.toast("확인이 오래 걸리고 있습니다. 잠시 후 새로고침해주세요."); return; }
    timers.push(setTimeout(async () => {
      try {
        const run = await api<CitationRunStatus>(`/api/citations/runs/${runId}`);
        if (run.state === "queued" || run.state === "running") { label(run.state === "queued" ? "확인 대기 중…" : `인용 확인 중… ${run.progress}%`); poll(runId, round + 1); return; }
        busy(false); label("인용 다시 확인");
        if (run.state === "succeeded") { tools.toast(`AI 인용 확인 완료 · 글 ${run.checked}개를 확인했습니다.`); timers.push(setTimeout(() => window.location.reload(), 800)); }
        else tools.toast(run.state === "canceled" ? "AI 인용 확인을 취소했습니다." : run.errorMessage || "AI 인용 확인에 실패했습니다.");
      } catch (e) { busy(false); label("인용 다시 확인"); tools.toast(e instanceof Error ? e.message : "확인 상태를 불러오지 못했습니다."); }
    }, round === 0 ? 400 : 2000));
  };
  const start = async () => {
    const blogId = runButton?.dataset.citationBlog;
    if (!runButton || !blogId || runButton.getAttribute("aria-busy") === "true") return;
    busy(true); label("확인 대기 중…");
    try {
      const run = await api<CitationRunStatus>("/api/citations/runs", { method: "POST", body: { blogId, idempotencyKey: crypto.randomUUID() } });
      poll(run.id);
    } catch (e) {
      busy(false); label(rows.length ? "인용 다시 확인" : "인용 확인 시작");
      const message = e instanceof ApiError || e instanceof Error ? e.message : "AI 인용 확인을 시작하지 못했습니다.";
      tools.toast(message); mutate.content(note, message);
    }
  };
  if (runButton?.dataset.citationRun) poll(runButton.dataset.citationRun);
  return (target: HTMLElement) => {
    if (runButton && target.closest("button") === runButton) { void start(); return true; }
    const filterButton = target.closest<HTMLElement>(".mui-5vm3uw > button");
    if (filterButton && filters.includes(filterButton)) { filter = filters.indexOf(filterButton); selectGroup(filters, filterButton, mutate, active, inactive); apply(); return true; }
    const sortButton = target.closest<HTMLElement>(".mui-10egq61 [role='button']");
    if (sortButton && sorts.includes(sortButton)) {
      const next = sorts.indexOf(sortButton); descending = next === sort ? !descending : next !== 2; sort = next;
      selectGroup(sorts, sortButton, mutate, sortActive, sortInactive);
      sorts.forEach((el, index) => mutate.attr(el, "aria-label", `${text(el)} 정렬${index === sort ? descending ? ", 내림차순" : ", 오름차순" : ""}`));
      apply(); return true;
    }
    const combo = target.closest<HTMLElement>("[role='combobox']");
    if (combo) { openScopeMenu(combo); return true; }
    const detail = target.closest<HTMLButtonElement>("button[data-result-id]");
    if (detail?.dataset.resultId) { tools.openDialog("AI 인용 상세", <CitationDetail id={detail.dataset.resultId} tools={tools} />, true); return true; }
    const help = target.closest("button[aria-label$='설명'], .mui-1v5qcm9 button");
    if (help) {
      const helpLabel = help.getAttribute("aria-label") || "AI 성과 설명";
      const descriptions: Record<string, React.ReactNode> = {
        "대표 키워드 설명": <div style={{ display: "grid", gap: 12, lineHeight: 1.7, fontSize: 14 }}>
          <div><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700, background: "rgba(3,199,90,0.14)", color: "#03c75a", marginBottom: 4 }}>메인 키워드</span>
            <p style={{ margin: 0 }}>포스팅 태그 또는 제목 앞부분에서 추출된 핵심 키워드입니다. 테이블에 표시되며, 네이버 통합검색 노출 및 AI 브리핑 인용 여부를 이 키워드로 확인합니다.</p></div>
          <div><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700, background: "rgba(148,163,184,0.16)", color: "#cbd5e1", marginBottom: 4 }}>서브 키워드</span>
            <p style={{ margin: 0 }}>포스팅에서 함께 추출된 보조 키워드입니다. 상세 보기에서 각 키워드의 검색량·경쟁강도·문서수·포화도를 확인할 수 있습니다.</p></div>
        </div>,
        "검색량 및 포화도 설명": <div style={{ display: "grid", gap: 12, lineHeight: 1.7, fontSize: 14 }}>
          <div><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700, background: "rgba(96,165,250,0.14)", color: "#60a5fa", marginBottom: 4 }}>검색량</span>
            <p style={{ margin: 0 }}>네이버에서 최근 한 달간 해당 키워드가 검색된 총 횟수(PC + 모바일)입니다. 숫자가 클수록 많은 사람이 찾는 키워드입니다.</p></div>
          <div><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700, background: "rgba(167,139,250,0.14)", color: "#a78bfa", marginBottom: 4 }}>포화도</span>
            <p style={{ margin: 0 }}>검색량 대비 블로그 문서 수 비율(문서수 ÷ 검색량 × 100)입니다. 낮을수록 경쟁이 적은 블루오션 키워드이며, 0.5% 미만이면 초록색으로 표시됩니다.</p></div>
        </div>,
        "통합검색 노출 설명": <div style={{ display: "grid", gap: 12, lineHeight: 1.7, fontSize: 14 }}>
          <div><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700, background: "rgba(224,90,82,0.14)", color: "#e05a52", marginBottom: 4 }}>O 통합검색 노출</span>
            <p style={{ margin: 0 }}>대표 키워드로 네이버 통합검색 시 첫 페이지 일반 결과에 내 블로그 글이 노출되고 있는 상태입니다.</p></div>
          <div><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700, background: "rgba(148,163,184,0.16)", color: "#94a3b8", marginBottom: 4 }}>X 미노출</span>
            <p style={{ margin: 0 }}>통합검색 첫 페이지에서 내 블로그 글이 확인되지 않은 상태입니다.</p></div>
        </div>,
        "AI 성과 설명": <div style={{ display: "grid", gap: 12, lineHeight: 1.7, fontSize: 14 }}>
          <div><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700, background: "rgba(3,199,90,0.14)", color: "#03c75a", marginBottom: 4 }}>본문 · 이미지 인용</span>
            <p style={{ margin: 0 }}>네이버 AI 브리핑 답변의 본문 출처나 이미지(썸네일) 출처에 내 블로그 글이 인용된 상태이며, 출처 순위를 표시합니다.</p></div>
          <div><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700, background: "rgba(148,163,184,0.16)", color: "#94a3b8", marginBottom: 4 }}>미추천 / -</span>
            <p style={{ margin: 0 }}>미추천(미인용)은 해당 키워드에 AI 브리핑이 존재하지만 내 블로그가 출처에 포함되지 않은 상태이며, -는 AI 브리핑 자체가 없는 키워드입니다.</p></div>
        </div>,
      };
      tools.openDialog(helpLabel, descriptions[helpLabel] || descriptions["AI 성과 설명"]); return true;
    }
    return false;
  };
}

function installDashboard(root: HTMLElement, tools: BehaviorTools, mutate: ReturnType<typeof mutations>, cleanup: Cleanup[]) {
  const feedTabs = elements(root, ".mui-f4pwje button");
  const feedActive = feedTabs[1]?.className; const feedInactive = feedTabs[0]?.className;
  // 실제 진단: 서버가 넣어 준 data-scan-blog/data-scan-job으로 작업을 만들고 상태를 폴링한다.
  const scanButton = root.querySelector<HTMLButtonElement>("button[data-scan-blog]") || undefined;
  let polling = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  cleanup.push(() => timers.forEach(clearTimeout));
  const setScanLabel = (label: string) => {
    if (!scanButton) return;
    const textNode = [...scanButton.childNodes].reverse().find(node => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.textContent = label; else scanButton.append(label);
  };
  const busy = (on: boolean) => { mutate.attr(scanButton || null, "aria-busy", on ? "true" : "false"); mutate.attr(scanButton || null, "disabled", on ? "" : null); };
  type ScanStatus = { id: string; state: "queued" | "running" | "succeeded" | "failed" | "canceled"; progress: number; errorMessage: string | null; result: { score?: number; postCount?: number } | null };
  const poll = (jobId: string, round = 0) => {
    polling = true; busy(true);
    if (round >= 200) { polling = false; busy(false); setScanLabel("블로그 스캔"); tools.toast("진단이 오래 걸리고 있습니다. 잠시 후 새로고침해주세요."); return; }
    timers.push(setTimeout(async () => {
      try {
        const job = await api<ScanStatus>(`/api/scans/${jobId}`);
        if (job.state === "queued" || job.state === "running") { setScanLabel(job.state === "queued" ? "대기 중…" : `진단 중… ${job.progress}%`); poll(jobId, round + 1); return; }
        polling = false; busy(false); setScanLabel("블로그 스캔");
        if (job.state === "succeeded") { tools.toast(`진단 완료 · ${job.result?.score ?? 0}점, 글 ${job.result?.postCount ?? 0}개를 분석했습니다.`); timers.push(setTimeout(() => window.location.reload(), 800)); }
        else tools.toast(job.state === "canceled" ? "진단이 취소되었습니다." : job.errorMessage || "진단에 실패했습니다.");
      } catch (error) {
        polling = false; busy(false); setScanLabel("블로그 스캔");
        tools.toast(error instanceof Error ? error.message : "진단 상태를 확인하지 못했습니다.");
      }
    }, round === 0 ? 300 : 1500));
  };
  const scan = async () => {
    if (!scanButton || polling) return;
    const blogId = scanButton.dataset.scanBlog;
    if (!blogId) { tools.toast("먼저 설정에서 네이버 블로그를 연결해주세요."); tools.navigate("/dashboard/settings"); return; }
    busy(true); setScanLabel("대기 중…");
    try {
      const job = await api<ScanStatus>("/api/scans", { method: "POST", body: { blogId, idempotencyKey: crypto.randomUUID() } });
      poll(job.id);
    } catch (error) {
      busy(false); setScanLabel("블로그 스캔");
      tools.toast(error instanceof ApiError || error instanceof Error ? error.message : "진단을 시작하지 못했습니다.");
    }
  };
  if (scanButton?.dataset.scanJob) poll(scanButton.dataset.scanJob);
  return (target: HTMLElement) => {
    const button = target.closest<HTMLElement>("button");
    if (button && feedTabs.includes(button)) {
      selectGroup(feedTabs, button, mutate, feedActive, feedInactive);
      const days = text(button) === "일주일" ? 7 : text(button) === "한달" ? 30 : Infinity;
      const list = root.querySelector(".mui-hgyhg8");
      const rows = list ? Array.from(list.children) : [];
      let count = 0;
      rows.forEach(row => {
        const relative = text(row).match(/(\d+)\s*(일|주|개월|시간|분)\s*전/);
        const age = relative ? Number(relative[1]) * ({ 일: 1, 주: 7, 개월: 30, 시간: 1 / 24, 분: 1 / 1440 }[relative[2]] || 0) : 0;
        const show = age <= days; mutate.attr(row, "style", show ? null : "display:none"); if (show) count++;
      });
      mutate.content(root.querySelector(".mui-1wh8gjw"), `${days === Infinity ? "전체 기간" : `최근 ${days}일`} 변화 ${count}건을 시간순으로 보여드립니다`);
      return true;
    }
    if (button === scanButton) { void scan(); return true; }
    const actionToggle = target.closest<HTMLButtonElement>("button[data-action-id]");
    if (actionToggle) {
      const done = actionToggle.getAttribute("aria-pressed") === "true";
      actionToggle.disabled = true;
      api(`/api/actions/${actionToggle.dataset.actionId}`, { method: "PATCH", body: { status: done ? "open" : "done", version: Number(actionToggle.dataset.version) } })
        .then(() => { tools.toast(done ? "할 일 완료를 취소했습니다." : "할 일을 완료로 표시했습니다."); window.location.reload(); })
        .catch(error => { actionToggle.disabled = false; tools.toast(error instanceof Error ? error.message : "저장하지 못했습니다."); });
      return true;
    }
    if (button && text(button) === "변경") { tools.navigate("/dashboard/settings"); return true; }
    const card = target.closest<HTMLElement>("[role='button'][aria-label$='AI 브리핑 캡처 상세보기']");
    if (card) {
      const image = card.querySelector<HTMLImageElement>("img");
      if (image) tools.openDialog(card.getAttribute("aria-label")?.replace(" 상세보기", "") || "AI 브리핑 캡처", <img src={image.getAttribute("src") || ""} alt={card.getAttribute("aria-label") || "AI 브리핑 캡처"} style={{ width: "100%", maxHeight: "76vh", objectFit: "contain", borderRadius: 8 }} />);
      return true;
    }
    return false;
  };
}

export const installAnalysis: InstallBehavior = (root, tools) => {
  const cleanup: Cleanup[] = [];
  const mutate = mutations();
  const handle = tools.pathname === "/dashboard/ai-picks" ? installAi(root, tools, mutate, cleanup) : tools.pathname === "/dashboard" ? installDashboard(root, tools, mutate, cleanup) : () => false;
  const click = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("*") : null;
    if (!target || event.defaultPrevented || target.closest("[data-naeo-live]")) return;
    if (handle(target)) { event.preventDefault(); return; }
    const search = target.closest<HTMLElement>("[role='link'][aria-label$='네이버 검색']");
    if (search) { event.preventDefault(); window.open(`https://search.naver.com/search.naver?query=${encodeURIComponent(text(search))}`, "_blank", "noopener,noreferrer"); }
  };
  const key = (event: KeyboardEvent) => {
    if (event.target instanceof Element && event.target.closest("[data-naeo-live]")) return;
    if (event.target instanceof HTMLElement && event.target.matches("[role='tab']") && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      const group = event.target.closest("[role='tablist']");
      const tabs = group ? elements(group, "[role='tab']") : [];
      const index = tabs.indexOf(event.target);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
    }
    if ((event.key === "Enter" || event.key === " ") && event.target instanceof HTMLElement && event.target.matches("[role='button'],[role='link'],[role='combobox']")) { event.preventDefault(); event.target.click(); }
  };
  root.addEventListener("click", click); root.addEventListener("keydown", key);
  return () => { root.removeEventListener("click", click); root.removeEventListener("keydown", key); cleanup.reverse().forEach(fn => fn()); mutate.cleanup(); };
};
