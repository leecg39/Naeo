import React from "react";
import { type BehaviorTools, type InstallBehavior, text } from "@/lib/behavior";

type Cleanup = () => void;
type AiRow = {
  element: HTMLElement; index: number; title: string; keyword: string; link: string;
  dates: string; volume: number; saturation: number; exposed: boolean;
  briefing: boolean; recommended: boolean; performance: string;
};

const captureImages: Record<string, string> = {
  "병역특례업체 합격": "/assets/e7260a4d8541f73c.webp",
  "군포시 우수기업": "/assets/5762762b6b97d1f0.webp",
  "SMATEC 공장자동화": "/assets/4e6985d9336eebb5.webp",
  "블록체인 보안 고도화": "/assets/a959e4bb2d8663c0.webp",
  "병역특례업체 신청": "/assets/3d8083cbfe3e1d91.webp",
  "다자녀가구 통행료 할인": "/assets/77edcdfbd38275ae.webp",
  "성과공유기업 인증": "/assets/4a797c419c129796.webp",
  "우수기업연구소 지정": "/assets/600aa33b5a49cfd5.webp",
  "병역특례업체 자격": "/assets/bea73e58dbe51acd.webp",
  "산업기능요원 선정 결과": "/assets/6b654a3facdcba22.webp",
  "제조혁신바우처": "/assets/3994df4f5d079b44.webp",
  "병역특례업체 요건": "/assets/be1c4436fd56a31f.webp",
  "전문연구요원 병역특례업체": "/assets/8a6f9d52a62748d0.webp",
  "전문연구요원 병역지정업체": "/assets/8a6f9d52a62748d0.webp",
  "병역특례기간": "/assets/423e0a681bdfa537.webp",
  "병역특례업체 자격요건": "/assets/be1c4436fd56a31f.webp",
  "전동지게차 지원사업": "/assets/7a211af9061de2de.webp",
  "Windows11 창 최소화": "/assets/4331813a6170e65c.webp",
  "중소기업 혁신바우처": "/assets/d44064f9f0217ac9.webp",
  "산업기능요원 신청 자격": "/assets/103e975a5ebe479c.webp",
  "전문연구요원 신청": "/assets/3351209189aac8c8.webp",
  "병역지정업체 신청": "/assets/757371520d94fc75.webp",
  "병원 사내근로복지기금": "/assets/0cc81e0ce3aecbf1.webp",
  "벤처기업인증 신청": "/assets/c4e2578647a4e39a.webp",
  "용인시 중소기업 전시회": "/assets/c0f12c9e13398306.webp",
  "전문연구요원 병역특례업체 신청": "/assets/a9663d587165fd91.webp",
  "전문연구요원 병역지정업체 신청": "/assets/51f9d4f2406421cd.webp",
  "인재육성형 중소기업 지정": "/assets/ca02b3ab9cf717df.webp"
};
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

function showDetail(row: AiRow, tools: BehaviorTools) {
  const image = captureImages[row.keyword];
  tools.openDialog("AI 인용 상세", <div style={{ display: "grid", gap: 18 }}>
    <div><p style={{ color: "#03c75a", fontSize: 13, marginBottom: 8 }}>{row.keyword}</p><h3 style={{ fontSize: 19, lineHeight: 1.5 }}>{row.title}</h3></div>
    <dl style={{ display: "grid", gridTemplateColumns: "minmax(100px, 1fr) 2fr", gap: "12px 20px", fontSize: 14 }}>
      <dt>분석일 / 발행일</dt><dd>{row.dates}</dd>
      <dt>검색량</dt><dd>{row.volume.toLocaleString("ko-KR")}</dd>
      <dt>포화도</dt><dd>{row.saturation.toLocaleString("ko-KR")}%</dd>
      <dt>통합검색 노출</dt><dd>{row.exposed ? "노출됨" : "미노출"}</dd>
      <dt>AI 브리핑</dt><dd>{row.briefing ? "브리핑 확인됨" : "브리핑 없음"}</dd>
      <dt>AI 인용</dt><dd>{row.recommended ? `${row.performance}${row.keyword === "병역특례업체 합격" ? " · 본문 5위" : ""}` : row.briefing ? "내 글 미추천" : "-"}</dd>
    </dl>
    {image && <img src={image} alt={`${row.keyword} AI 브리핑 캡처`} style={{ width: "100%", maxHeight: "55vh", objectFit: "contain", borderRadius: 10, background: "#fff" }} />}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      {row.link && <a className="naeo-button" href={row.link} target="_blank" rel="noopener noreferrer">원문 보기</a>}
      {row.link && <button className="naeo-button secondary" onClick={() => copyLink(row.link, tools)}>링크 복사</button>}
    </div>
  </div>);
}

function installAi(root: HTMLElement, tools: BehaviorTools, mutate: ReturnType<typeof mutations>, cleanup: Cleanup[]) {
  const container = root.querySelector<HTMLElement>(".mui-uien4a");
  if (!container) return () => false;
  const rows: AiRow[] = Array.from(container.children).filter((el): el is HTMLElement => el instanceof HTMLElement).map((element, index) => {
    const cells = Array.from(element.children);
    const performance = text(cells[5]);
    const metric = text(cells[3]).split("/");
    return { element, index, title: text(cells[1]), keyword: text(cells[2]), link: cells[1]?.querySelector<HTMLAnchorElement>("a")?.href || "", dates: text(cells[0]), volume: number(metric[0]), saturation: number(metric[1] || ""), exposed: text(cells[4]) === "O", briefing: performance !== "-", recommended: performance !== "-" && performance !== "미추천", performance };
  });
  cleanup.push(() => rows.forEach(row => container.append(row.element)));
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
  const apply = () => {
    const visible = rows.filter(row => filter === 0 || filter === 1 && row.exposed || filter === 2 && row.briefing || filter === 3 && row.recommended);
    const accepted = new Set(visible);
    rows.forEach(row => mutate.attr(row.element, "style", accepted.has(row) ? null : "display:none"));
    visible.sort((a, b) => {
      const difference = sort === 1 ? a.volume - b.volume : sort === 2 ? a.saturation - b.saturation : b.index - a.index;
      return (descending ? -1 : 1) * difference || a.index - b.index;
    }).forEach(row => container.append(row.element));
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
    menu.style.cssText = `position:fixed;z-index:1500;left:${rect.left}px;top:${rect.bottom + 5}px;min-width:${Math.max(rect.width, 120)}px;padding:6px;background:#222;border-radius:10px;box-shadow:0 8px 30px #0008`;
    mutate.attr(combo, "aria-expanded", "true");
    const close = () => { menu.remove(); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); mutate.attr(combo, "aria-expanded", "false"); closeMenu = undefined; };
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node) && !combo.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { close(); combo.focus(); } };
    ["전체", "미분류"].forEach(label => {
      const option = document.createElement("button");
      option.type = "button"; option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(category === label)); option.textContent = label;
      option.style.cssText = `display:block;width:100%;border:0;padding:10px 16px;text-align:left;border-radius:6px;cursor:pointer;color:inherit;background:${category === label ? "#03c75a26" : "transparent"}`;
      option.addEventListener("click", () => { category = label; mutate.content(combo, label); apply(); close(); combo.focus(); });
      menu.append(option);
    });
    document.body.append(menu); document.addEventListener("pointerdown", outside); document.addEventListener("keydown", key);
    closeMenu = close; menu.querySelector<HTMLButtonElement>("button[aria-selected='true']")?.focus();
  };
  return (target: HTMLElement) => {
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
    const detail = target.closest("button");
    if (detail && text(detail) === "상세 보기") {
      const row = rows.find(row => row.element.contains(detail)); if (row) showDetail(row, tools); return true;
    }
    const help = target.closest("button[aria-label$='설명'], .mui-1v5qcm9 button");
    if (help) {
      const label = help.getAttribute("aria-label") || "AI 성과 설명";
      const descriptions: Record<string, string> = {
        "대표 키워드 설명": "포스트의 주제를 대표하는 검색어입니다. 이 키워드로 통합검색 노출과 AI 브리핑 인용 여부를 확인합니다.",
        "검색량 및 포화도 설명": "검색량은 키워드의 월간 검색 횟수입니다. 포화도는 검색량에 비해 등록된 문서가 얼마나 많은지 보여주는 비율입니다.",
        "통합검색 노출 설명": "O는 해당 키워드의 네이버 통합검색 결과에 글이 노출되었음을, X는 확인 시점에 노출되지 않았음을 뜻합니다.",
        "AI 성과 설명": "AI 브리핑에 내 글의 본문이나 이미지가 출처로 인용되면 인용 유형과 순위를 표시합니다. 미추천은 브리핑이 있지만 내 글은 인용되지 않은 상태입니다.",
      };
      tools.openDialog(label, <p style={{ lineHeight: 1.8 }}>{descriptions[label] || descriptions["AI 성과 설명"]}</p>); return true;
    }
    return false;
  };
}

function installCompetitors(root: HTMLElement, mutate: ReturnType<typeof mutations>, cleanup: Cleanup[]) {
  const table = root.querySelector<HTMLTableElement>("table");
  const body = table?.tBodies[0];
  if (!table || !body) return () => false;
  const rows = Array.from(body.querySelectorAll<HTMLTableRowElement>(":scope > tr"));
  cleanup.push(() => rows.forEach(row => body.append(row)));
  const filters = elements(root, ".mui-186wd1t button");
  const active = filters[0]?.className; const inactive = filters[1]?.className;
  const headers = Array.from(table.querySelectorAll<HTMLElement>("th"));
  const headerName = (header: Element) => text(header).replace(/[▲▼]/g, "");
  const dateColumn = headers.findIndex(header => headerName(header) === "분석일");
  let sortColumn = headers.findIndex(header => headerName(header) === "검색량");
  let descending = true;
  const sortable = headers.filter(header => /분석일|검색량|포화도|내 순위|AI 추천/.test(text(header)));
  sortable.forEach(header => { mutate.attr(header, "tabindex", "0"); mutate.attr(header, "role", "button"); mutate.attr(header, "aria-label", `${text(header).replace(/[▲▼]/g, "")} 정렬`); });
  const report = statusElement(table.parentElement, cleanup);
  const parseDate = (row: HTMLTableRowElement) => {
    const [month, day] = text(row.cells[dateColumn]).split("/").map(Number);
    return new Date(2026, month - 1, day).getTime();
  };
  // The snapshot is dated 2026-10-13; its period filters use that same baseline.
  const baseline = new Date(2026, 9, 13);
  return (target: HTMLElement) => {
    const button = target.closest<HTMLElement>(".mui-186wd1t button");
    if (button && filters.includes(button)) {
      selectGroup(filters, button, mutate, active, inactive);
      const index = filters.indexOf(button);
      const start = new Date(baseline);
      if (index === 1) start.setDate(start.getDate() - (start.getDay() + 6) % 7);
      if (index === 2) start.setDate(1);
      if (index === 3) start.setMonth(start.getMonth() - 3);
      let count = 0;
      rows.forEach(row => { const visible = index === 0 || parseDate(row) >= start.getTime(); mutate.attr(row, "style", visible ? null : "display:none"); if (visible) count++; });
      report(`${text(button)} · ${count}개 키워드 · 분석 기준 2026.10.13`); return true;
    }
    const header = target.closest<HTMLElement>("th");
    if (header && sortable.includes(header)) {
      const column = headers.indexOf(header); const label = headerName(header);
      descending = column === sortColumn ? !descending : label !== "포화도" && label !== "내 순위"; sortColumn = column;
      headers.forEach(el => mutate.attr(el, "aria-sort", el === header ? descending ? "descending" : "ascending" : "none"));
      const value = (row: HTMLTableRowElement) => label === "분석일" ? parseDate(row) : label === "AI 추천" ? /내 본문|내 이미지/.test(text(row.cells[column])) ? 1 : 0 : label === "내 순위" && text(row.cells[column]) === "-" ? Infinity : number(text(row.cells[column]));
      [...rows].sort((a, b) => (value(a) - value(b)) * (descending ? -1 : 1)).forEach(row => body.append(row));
      report(`${text(header).replace(/[▲▼]/g, "")} ${descending ? "내림차순" : "오름차순"} 정렬`); return true;
    }
    return false;
  };
}

function installDashboard(root: HTMLElement, tools: BehaviorTools, mutate: ReturnType<typeof mutations>, cleanup: Cleanup[]) {
  // Recharts snapshots retain their measured desktop width. Preserve the SVG
  // viewBox while letting its real chart DOM fit narrower layouts.
  elements(root, ".recharts-responsive-container").forEach(container => {
    const inner = container.firstElementChild;
    const chart = container.querySelector(".recharts-wrapper");
    const legend = container.querySelector(".recharts-legend-wrapper");
    [inner, chart, legend].forEach(el => { if (el) mutate.attr(el, "style", `${el.getAttribute("style") || ""};width:100%;max-width:100%`); });
  });
  const chartTabs = elements(root, "[aria-label='성장 추세 기간'] button");
  const categoryTabs = elements(root, "[aria-label='랭킹 범위'] button");
  const feedTabs = elements(root, ".mui-f4pwje button");
  const chartActive = chartTabs.find(el => el.getAttribute("aria-selected") === "true")?.className;
  const chartInactive = chartTabs[0]?.className;
  const categoryActive = categoryTabs[0]?.className; const categoryInactive = categoryTabs[1]?.className;
  const feedActive = feedTabs[1]?.className; const feedInactive = feedTabs[0]?.className;
  const rank = root.querySelector<HTMLElement>(".mui-63uc4g");
  const scanButton = elements(root, "button").find(el => text(el) === "블로그 스캔") as HTMLButtonElement | undefined;
  let scanning = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  cleanup.push(() => timers.forEach(clearTimeout));
  const credits = elements(root, "p,span").find(el => /^\d+회 남음$/.test(text(el)));
  const scanTime = elements(root, "p,span").find(el => text(el).startsWith("마지막 스캔:"));
  let scans = 0;
  try { scans = Math.max(0, Math.min(20, Number(localStorage.getItem("naeo-clone:analysis-scans")) || 0)); } catch { /* Storage can be disabled. */ }
  const updateCredits = () => {
    mutate.content(credits || null, `${20 - scans}회 남음`);
    elements(root, "p,span").filter(el => /^스캔 \d+회$/.test(text(el))).forEach(el => mutate.content(el, `스캔 ${20 - scans}회`));
  };
  const formatScanTime = (date: Date) => date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  if (scans) {
    updateCredits();
    try {
      const saved = localStorage.getItem("naeo-clone:analysis-last-scan");
      if (saved && !Number.isNaN(Date.parse(saved))) mutate.content(scanTime || null, `마지막 스캔: ${formatScanTime(new Date(saved))}`);
    } catch { /* Stored scan data is optional. */ }
  }
  const setScanLabel = (label: string) => mutate.content(scanButton || null, label);
  const scan = () => {
    if (!scanButton || scanning) return;
    if (scans >= 20) { tools.toast("데모 스캔 횟수를 모두 사용했습니다."); return; }
    scanning = true; mutate.attr(scanButton, "disabled", ""); mutate.attr(scanButton, "aria-busy", "true"); setScanLabel("블로그 확인 중…");
    timers.push(setTimeout(() => setScanLabel("AI 인용 분석 중…"), 500));
    timers.push(setTimeout(() => {
      scans++; scanning = false; updateCredits(); setScanLabel("블로그 스캔"); mutate.attr(scanButton, "disabled", null); mutate.attr(scanButton, "aria-busy", "false");
      const now = new Date(); const stamp = formatScanTime(now);
      mutate.content(scanTime || null, `마지막 스캔: ${stamp} (방금 전)`);
      try { localStorage.setItem("naeo-clone:analysis-scans", String(scans)); localStorage.setItem("naeo-clone:analysis-last-scan", now.toISOString()); } catch { /* Non-persistent demo still works. */ }
      tools.toast("데모 분석 완료 · 글 50개, 통합검색 노출 7개, AI 인용 1개를 확인했습니다.");
    }, 1500));
  };
  return (target: HTMLElement) => {
    const button = target.closest<HTMLElement>("button");
    if (button && chartTabs.includes(button)) {
      selectGroup(chartTabs, button, mutate, chartActive, chartInactive);
      const days = text(button) === "전체" ? 2 : number(text(button));
      const subtitle = root.querySelector(".mui-xb6up5 .mui-47u1fc");
      mutate.content(subtitle, `${text(button) === "전체" ? "전체 기간" : `최근 ${days}일`} · 분석 기록 2회 · AI 추천 1건 / 통합검색 노출 7건`);
      const svg = root.querySelector<SVGSVGElement>(".mui-xb6up5 svg[role='application']");
      if (svg) {
        const startX = 1091 - 1063 / Math.max(1, days - 1);
        svg.querySelectorAll<SVGPathElement>(".recharts-area-curve, .recharts-area-area").forEach(path => {
          const curve = path.getAttribute("d") || "";
          mutate.attr(path, "d", curve.replace(/^M[\d.]+,/, `M${startX},`).replace(/L[\d.]+,184\.805Z$/, `L${startX},184.805Z`));
        });
        svg.querySelectorAll<SVGCircleElement>("circle").forEach(circle => { if (Number(circle.getAttribute("cx")) !== 1091) mutate.attr(circle, "cx", String(startX)); });
        const date = new Date(2026, 9, 13); date.setDate(date.getDate() - days + 1);
        const startLabel = svg.querySelector(".recharts-xAxis tspan");
        mutate.content(startLabel, `${date.getMonth() + 1}/${date.getDate()}`);
        mutate.attr(svg, "aria-label", `${text(button)} 성장 추세. 10월 12일 0건, 10월 13일 AI 추천 1건, 통합검색 노출 7건.`);
      }
      return true;
    }
    if (button && categoryTabs.includes(button)) {
      selectGroup(categoryTabs, button, mutate, categoryActive, categoryInactive);
      const category = text(button);
      mutate.content(rank?.querySelector(".mui-47u1fc") || null, category === "모든 블로그" ? "모든 블로그 중 내 순위" : "비즈니스·경제 블로그 중 내 순위 · 매일 0시 집계");
      const categoryMode = category !== "모든 블로그";
      elements(rank || root, ".mui-tprmff").forEach(card => {
        const value = card.querySelector(".mui-1c2fwzk");
        const description = card.querySelector(".mui-qtwa3i");
        if (!card.dataset.originalRank) { card.dataset.originalRank = text(value); card.dataset.originalPopulation = text(description); }
        mutate.content(value, categoryMode ? "-" : card.dataset.originalRank);
        mutate.content(description, categoryMode ? "순위 데이터 없음" : card.dataset.originalPopulation || "");
        mutate.attr(card.querySelector(".mui-16eue6i"), "style", categoryMode ? "display:none" : null);
      });
      return true;
    }
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
    if (button === scanButton) { scan(); return true; }
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
  const handle = tools.pathname === "/dashboard/ai-picks" ? installAi(root, tools, mutate, cleanup) : tools.pathname === "/dashboard/competitors" ? installCompetitors(root, mutate, cleanup) : tools.pathname === "/dashboard" ? installDashboard(root, tools, mutate, cleanup) : () => false;
  const click = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("*") : null;
    if (!target || event.defaultPrevented) return;
    if (handle(target)) { event.preventDefault(); return; }
    const search = target.closest<HTMLElement>("[role='link'][aria-label$='네이버 검색']");
    if (search) { event.preventDefault(); window.open(`https://search.naver.com/search.naver?query=${encodeURIComponent(text(search))}`, "_blank", "noopener,noreferrer"); }
  };
  const key = (event: KeyboardEvent) => {
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
