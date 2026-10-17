import React from "react";
import { api, ApiError } from "@/lib/api-client";
import { type BehaviorTools, type InstallBehavior, text } from "@/lib/behavior";

type Cleanup = () => void;
type AiRow = {
  element: HTMLElement; index: number; resultId: string; title: string; keyword: string; link: string; category: string;
  publishedAt: number; volume: number; saturation: number; exposed: boolean; briefing: boolean; recommended: boolean;
};
type Source = { title: string; link: string; source?: string; platform?: string; mine: boolean; samePost: boolean };
type CitationDetailData = {
  id: string; postId: string; title: string; url: string; category: string; publishedAt: number | null; checkedAt: number;
  keyword: string; keywordSource: "member" | "tag" | "title"; keywordVersion: number; status: "checked" | "error";
  briefing: boolean; exposed: boolean; textRank: number | null; imageRank: number | null; volume: number | null; saturation: number | null;
  briefingDetail: { markdown: string; questions: string[]; references: (Source & { index: number; snippet: string })[]; media: (Source & { position: number })[] } | null;
  exposure: { section: string; position: number } | null; error: { code: string; message: string } | null;
};
type CitationRunStatus = { id: string; state: "queued" | "running" | "succeeded" | "failed" | "canceled"; progress: number; checked: number; errorMessage: string | null };
const KEYWORD_SOURCE = { member: "직접 지정", tag: "첫 태그", title: "제목" } as const;
const number = (value: string) => Number(value.replace(/[^\d.-]/g, "")) || 0;
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
const performanceText = (d: Pick<CitationDetailData, "status" | "briefing" | "textRank" | "imageRank">) => {
  if (d.status === "error") return "확인 실패";
  const parts = [d.textRank !== null ? `본문 ${d.textRank}위` : "", d.imageRank !== null ? `이미지 ${d.imageRank}위` : ""].filter(Boolean);
  return parts.length ? `AI 추천 · ${parts.join(" · ")}` : d.briefing ? "AI 브리핑은 있지만 내 블로그는 미추천" : "AI 브리핑 없음";
};
const badge = (s: Source) => s.samePost ? <span style={{ marginLeft: 6, color: "#03c75a", fontWeight: 700 }}>이 글</span> : s.mine ? <span style={{ marginLeft: 6, color: "#03c75a", fontWeight: 700 }}>내 블로그</span> : null;
const listStyle: React.CSSProperties = { display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none", fontSize: 14 };
// 서버가 http(s)만 저장하지만 화면에서도 한 번 더 확인한다.
const safeHref = (link: string) => /^https?:\/\//i.test(link) ? link : undefined;
const sourceLink = (s: Source) => <a href={safeHref(s.link)} target="_blank" rel="noopener noreferrer nofollow" style={{ color: "inherit", overflowWrap: "anywhere" }}>{s.title || s.link}</a>;

/** 저장한 AI 브리핑 근거를 보여주고, 열람 기록(튜토리얼 조건)을 남긴다. 대표 키워드를 고치면 다음 확인부터 쓴다. */
function CitationDetail({ id, tools }: { id: string; tools: BehaviorTools }) {
  const [detail, setDetail] = React.useState<CitationDetailData | null>(null);
  const [error, setError] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [notice, setNotice] = React.useState("");
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
      const next = await api<{ keyword: string; source: CitationDetailData["keywordSource"]; version: number } | null>(`/api/citations/keywords/${detail.postId}`, remove ? { method: "DELETE", body: { version: detail.keywordVersion } } : { method: "PUT", body: { keyword, version: detail.keywordVersion } });
      setDetail({ ...detail, keywordSource: next?.source ?? detail.keywordSource, keywordVersion: next?.version ?? 0 });
      if (next) setKeyword(next.keyword);
      setNotice(remove ? "자동 대표 키워드로 되돌렸습니다. 다음 확인부터 적용됩니다." : "대표 키워드를 저장했습니다. 다음 확인부터 이 키워드로 확인합니다.");
    } catch (e) { setNotice(e instanceof Error ? e.message : "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };
  const b = detail.briefingDetail;
  return <div style={{ display: "grid", gap: 18 }}>
    <div><p style={{ color: "#03c75a", fontSize: 13, marginBottom: 8 }}>{detail.keyword}</p><h3 style={{ fontSize: 19, lineHeight: 1.5, overflowWrap: "anywhere" }}>{detail.title || "(제목 없음)"}</h3></div>
    <dl style={{ display: "grid", gridTemplateColumns: "minmax(100px, 1fr) 2fr", gap: "12px 20px", fontSize: 14 }}>
      <dt>확인일 / 발행일</dt><dd>{kstDay(detail.checkedAt)} / {detail.publishedAt ? kstDay(detail.publishedAt) : "-"}</dd>
      <dt>대표 키워드</dt><dd>{detail.keyword} ({KEYWORD_SOURCE[detail.keywordSource]})</dd>
      <dt>검색량 / 포화도</dt><dd>{detail.volume === null ? "지표 없음" : detail.volume.toLocaleString("ko-KR")} / {detail.saturation === null ? "-" : `${(detail.saturation * 100).toFixed(1)}%`}</dd>
      <dt>통합검색 노출</dt><dd>{detail.status === "error" ? "-" : detail.exposure ? `노출됨 · ${detail.exposure.section} ${detail.exposure.position}번째 결과` : "미노출"}</dd>
      <dt>AI 인용</dt><dd>{performanceText(detail)}</dd>
    </dl>
    {detail.error && <p role="alert" style={{ color: "#e05a52" }}>{detail.error.message}</p>}
    <form onSubmit={event => { event.preventDefault(); void save(false); }} style={{ display: "grid", gap: 8 }}>
      <label htmlFor={`citation-keyword-${detail.id}`} style={{ fontWeight: 700 }}>대표 키워드 수정</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input id={`citation-keyword-${detail.id}`} className="naeo-field" style={{ flex: "1 1 200px", width: "auto" }} value={keyword} maxLength={60} onChange={event => setKeyword(event.target.value)} disabled={saving} />
        <button type="submit" className="naeo-button" disabled={saving || keyword.trim().length < 2}>저장</button>
        {detail.keywordSource === "member" && <button type="button" className="naeo-button secondary" disabled={saving} onClick={() => void save(true)}>자동으로 되돌리기</button>}
      </div>
      {notice && <p role="status" style={{ fontSize: 13, color: "#a3a3a3" }}>{notice}</p>}
    </form>
    {b ? <>
      <section><h4 style={{ marginBottom: 8 }}>AI 브리핑 본문</h4><p style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.7, maxHeight: 260, overflow: "auto", padding: 12, borderRadius: 8, background: "rgba(255,255,255,.04)", overflowWrap: "anywhere" }}>{b.markdown || "(본문 없음)"}</p></section>
      <section><h4 style={{ marginBottom: 8 }}>본문 출처 ({b.references.length})</h4>{b.references.length ? <ol style={listStyle}>{b.references.map(r => <li key={`${r.index}-${r.link}`}><span style={{ color: "#a3a3a3" }}>[{r.index}] </span>{sourceLink(r)}{r.source ? <span style={{ color: "#a3a3a3" }}> · {r.source}</span> : null}{badge(r)}</li>)}</ol> : <p style={{ color: "#a3a3a3" }}>출처 없음</p>}</section>
      <section><h4 style={{ marginBottom: 8 }}>이미지 출처 ({b.media.length})</h4>{b.media.length ? <ol style={listStyle}>{b.media.map(m => <li key={`${m.position}-${m.link}`}><span style={{ color: "#a3a3a3" }}>{m.position}. </span>{sourceLink(m)}{m.platform ? <span style={{ color: "#a3a3a3" }}> · {m.platform}</span> : null}{badge(m)}</li>)}</ol> : <p style={{ color: "#a3a3a3" }}>이미지 출처 없음</p>}</section>
      <section><h4 style={{ marginBottom: 8 }}>관련 질문</h4>{b.questions.length ? <ul style={listStyle}>{b.questions.map(q => <li key={q}><a href={`/dashboard/write?keyword=${encodeURIComponent(q.slice(0, 60))}`} style={{ color: "#03c75a" }}>{q}</a></li>)}</ul> : <p style={{ color: "#a3a3a3" }}>관련 질문 없음</p>}</section>
    </> : <p style={{ color: "#a3a3a3" }}>{detail.status === "error" ? "이 키워드는 확인하지 못했습니다. 다음 확인에서 다시 시도합니다." : "확인 시점에 이 키워드의 AI 브리핑이 없었습니다."}</p>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      <a className="naeo-button" href={safeHref(detail.url)} target="_blank" rel="noopener noreferrer">원문 보기</a>
      <button type="button" className="naeo-button secondary" onClick={() => copyLink(detail.url, tools)}>링크 복사</button>
    </div>
  </div>;
}

function installAi(root: HTMLElement, tools: BehaviorTools, mutate: ReturnType<typeof mutations>, cleanup: Cleanup[]) {
  const container = root.querySelector<HTMLElement>(".mui-uien4a");
  if (!container) return () => false;
  const rows: AiRow[] = Array.from(container.children).filter((el): el is HTMLElement => el instanceof HTMLElement && !!el.dataset.resultId).map((element, index) => ({
    element, index, resultId: element.dataset.resultId || "", title: text(element.querySelector("a")), keyword: element.dataset.keyword || "",
    link: element.querySelector<HTMLAnchorElement>("a")?.href || "", category: element.dataset.category || "미분류", publishedAt: Number(element.dataset.publishedAt) || 0,
    volume: Number(element.dataset.volume ?? -1), saturation: Number(element.dataset.saturation ?? -1),
    exposed: element.dataset.exposed === "true", briefing: element.dataset.briefing === "true", recommended: element.dataset.cited === "true",
  }));
  cleanup.push(() => rows.forEach(row => container.append(row.element)));
  const requestedResult = new URLSearchParams(window.location.search).get("open");
  if (requestedResult && rows.some(row => row.resultId === requestedResult)) {
    const timer = setTimeout(() => tools.openDialog("AI 인용 상세", <CitationDetail id={requestedResult} tools={tools} />), 0);
    cleanup.push(() => clearTimeout(timer));
  }
  const filters = elements(root, ".mui-5vm3uw > button");
  const active = filters[0]?.className;
  const inactive = filters[1]?.className;
  const sorts = elements(root, ".mui-10egq61 [role='button']");
  const sortActive = sorts[0]?.className;
  const sortInactive = sorts[1]?.className;
  let filter = 0;
  let sort = 0;
  let descending = true;
  let category = "전체";
  const report = statusElement(container.parentElement, cleanup);
  const empty = document.createElement("p");
  empty.textContent = "조건에 맞는 글이 없습니다.";
  empty.style.cssText = "display:none;padding:48px 20px;text-align:center;color:#A3A3A3";
  container.append(empty);
  cleanup.push(() => empty.remove());
  // 지표가 없는 글(-1)은 정렬 방향과 관계없이 뒤에 둔다.
  const measured = (value: number, other: number) => value < 0 ? (other < 0 ? 0 : 1) : other < 0 ? -1 : null;
  const apply = () => {
    if (!rows.length) return;
    const visible = rows.filter(row => (category === "전체" || row.category === category) && (filter === 0 || filter === 1 && row.exposed || filter === 2 && row.briefing || filter === 3 && row.recommended));
    const accepted = new Set(visible);
    rows.forEach(row => mutate.attr(row.element, "style", accepted.has(row) ? null : "display:none"));
    visible.sort((a, b) => {
      const key = sort === 1 ? [a.volume, b.volume] : sort === 2 ? [a.saturation, b.saturation] : [a.publishedAt, b.publishedAt];
      const unknown = sort ? measured(key[0], key[1]) : null;
      if (unknown !== null) return unknown || a.index - b.index;
      return (descending ? -1 : 1) * (key[0] - key[1]) || a.index - b.index;
    }).forEach(row => container.insertBefore(row.element, empty));
    empty.style.display = visible.length ? "none" : "block";
    report(`${category} · ${visible.length}개 글 · ${["최신순", "검색량순", "포화도순"][sort]} ${descending ? "내림차순" : "오름차순"}`);
    mutate.attr(container, "aria-label", `${category} ${visible.length}개 글`);
  };
  let closeMenu: Cleanup | undefined;
  cleanup.push(() => closeMenu?.());
  const openCategory = (combo: HTMLElement) => {
    closeMenu?.();
    const menu = document.createElement("div");
    menu.className = "naeo-panel";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", "글 카테고리");
    const rect = combo.getBoundingClientRect();
    menu.style.cssText = `position:fixed;z-index:1500;left:${rect.left}px;top:${rect.bottom + 5}px;min-width:${Math.max(rect.width, 120)}px;max-height:320px;overflow:auto;padding:6px;background:#222;border-radius:10px;box-shadow:0 8px 30px #0008`;
    mutate.attr(combo, "aria-expanded", "true");
    const close = () => { menu.remove(); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); mutate.attr(combo, "aria-expanded", "false"); closeMenu = undefined; };
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node) && !combo.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { close(); combo.focus(); } };
    ["전체", ...new Set(rows.map(row => row.category))].forEach(label => {
      const option = document.createElement("button");
      option.type = "button"; option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(category === label)); option.textContent = label;
      option.style.cssText = `display:block;width:100%;border:0;padding:10px 16px;text-align:left;border-radius:6px;cursor:pointer;color:inherit;background:${category === label ? "#03c75a26" : "transparent"}`;
      option.addEventListener("click", () => { category = label; mutate.content(combo, label); apply(); close(); combo.focus(); });
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
    if (combo) { openCategory(combo); return true; }
    const detail = target.closest<HTMLButtonElement>("button[data-result-id]");
    if (detail?.dataset.resultId) { tools.openDialog("AI 인용 상세", <CitationDetail id={detail.dataset.resultId} tools={tools} />); return true; }
    const help = target.closest("button[aria-label$='설명'], .mui-1v5qcm9 button");
    if (help) {
      const helpLabel = help.getAttribute("aria-label") || "AI 성과 설명";
      const descriptions: Record<string, string> = {
        "대표 키워드 설명": "글마다 확인에 쓰는 검색어입니다. 직접 지정한 키워드가 있으면 그것을, 없으면 첫 태그, 태그가 없으면 제목의 첫 구절을 씁니다. 상세 보기에서 고칠 수 있습니다.",
        "검색량 및 포화도 설명": "검색량은 관리자가 등록한 키워드 지표의 월간 검색 횟수(PC+모바일)입니다. 포화도는 문서 수를 검색량으로 나눈 비율이며, 지표가 없으면 -로 표시합니다.",
        "통합검색 노출 설명": "O는 확인 시점에 대표 키워드의 네이버 통합검색 일반 결과에 이 글이 있었음을, X는 없었음을 뜻합니다.",
        "AI 성과 설명": "AI 브리핑의 본문 출처나 이미지 출처에 내 블로그 글이 있으면 출처 순서를 표시합니다. 미추천은 브리핑이 있지만 내 블로그가 출처에 없는 상태, -는 브리핑이 없는 상태입니다.",
      };
      tools.openDialog(helpLabel, <p style={{ lineHeight: 1.8 }}>{descriptions[helpLabel] || descriptions["AI 성과 설명"]}</p>); return true;
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
