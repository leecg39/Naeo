import type { InstallBehavior } from "@/lib/behavior";
import { text } from "@/lib/behavior";

type Keyword = {
  name: string;
  row: HTMLElement;
  card: HTMLElement | null;
  mobileWrapper: HTMLElement | null;
  cells: string[];
  day: number;
};
const COMPLETED_KEY = "naeo-clone:recommendations:completed";
const CHECKED_PATH = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m-9 14-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z";
const HELP: Record<string, string> = {
  전체: "PC와 모바일에서 발생한 월간 검색량의 합계입니다. 검색량이 클수록 해당 키워드에 대한 관심이 많다는 뜻이에요.",
  문서수: "해당 키워드와 관련해 검색되는 블로그 문서 수입니다. 검색량과 함께 비교하면 경쟁 정도를 살펴볼 수 있어요.",
  포화도: "문서수를 전체 검색량으로 나눈 값입니다. 낮을수록 검색 수요에 비해 문서가 적어 선점 가능성을 살펴보기 좋아요.",
  시그널: "키워드의 기회를 판단하는 참고 표시입니다. 황금 키워드와 선점기회 필터를 사용해 관심 있는 키워드를 찾아보세요.",
};

/** Interactions use the captured records; no production analysis or account calls occur. */
export const installRecommendations: InstallBehavior = (root, tools) => {
  const section = root.querySelector<HTMLElement>("#weekly-recommendations");
  if (!section) return;
  const cleanups: Array<() => void> = [];
  const originalAttributes = new Map<Element, Map<string, string | null>>();
  const originalTexts = new Map<Element, string>();
  const remember = (element: Element, name: string) => {
    let attributes = originalAttributes.get(element);
    if (!attributes) originalAttributes.set(element, (attributes = new Map()));
    if (!attributes.has(name)) attributes.set(name, element.getAttribute(name));
  };
  const attribute = (element: Element, name: string, value: string) => {
    remember(element, name);
    element.setAttribute(name, value);
  };
  const setText = (element: Element | null | undefined, value: string) => {
    if (!element) return;
    if (!originalTexts.has(element)) originalTexts.set(element, element.textContent || "");
    element.textContent = value;
  };
  const checkboxes = [...section.querySelectorAll<HTMLInputElement>('input[type="checkbox"][aria-label$=" 작성 완료 표시"]')];
  const rows = [...section.querySelectorAll<HTMLElement>('[role="table"] [role="row"]')];
  const records: Keyword[] = rows.map((row) => {
    const input = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const name = (input?.getAttribute("aria-label") || "").replace(/ 작성 완료 표시$/, "");
    const cardInput = checkboxes.find((checkbox) => checkbox.getAttribute("aria-label") === `${name} 작성 완료 표시` && !row.contains(checkbox));
    const card = cardInput?.closest<HTMLElement>('[id^="kw-card-"]') || null;
    const cells = [...row.querySelectorAll('[role="cell"]')].map(text);
    const date = cells[1]?.match(/(\d+)월\s*(\d+)일/);
    return { name, row, card, mobileWrapper: card?.parentElement || null, cells, day: date ? Date.UTC(2026, Number(date[1]) - 1, Number(date[2])) : 0 };
  }).filter((record) => record.name);
  if (!records.length) return;
  const rowParent = records[0].row.parentElement;
  const mobileParent = records[0].mobileWrapper?.parentElement;
  const originalRowOrder = rowParent ? [...rowParent.children] : [];
  const originalMobileOrder = mobileParent ? [...mobileParent.children] : [];
  const inputsOriginal = checkboxes.map((input) => ({ input, checked: input.checked }));
  const completed = new Set<string>();
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(COMPLETED_KEY) || "[]");
    if (Array.isArray(saved)) for (const name of saved) if (typeof name === "string") completed.add(name);
  } catch { /* Private browsing may prevent persistence. The controls still work. */ }
  let filter: "all" | "golden" | "opportunity" = "all";
  let period = "이번 주";
  let sortColumn = 5;
  let sortAscending = false;
  const referenceDay = Math.max(...records.map((record) => record.day));
  const date = new Date(referenceDay);
  const weekStart = referenceDay - ((date.getUTCDay() + 6) % 7) * 86400000;
  const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const periodButtons = [...section.querySelectorAll<HTMLButtonElement>("button")].filter((button) => /^(전체기간|이번 주|이번 달)$/.test(text(button)));
  const goldenButton = [...section.querySelectorAll<HTMLButtonElement>("button")].find((button) => text(button).includes("황금 전체보기"));
  const activeClass = periodButtons.find((button) => text(button) === "이번 주")?.className;
  const inactiveClass = periodButtons.find((button) => text(button) === "전체기간")?.className;
  const goldenCard = root.querySelector<HTMLElement>('[role="button"][aria-label^="황금 키워드:"]');
  const opportunityCard = root.querySelector<HTMLElement>('[role="button"][aria-label^="선점기회:"]');
  const counter = [...section.querySelectorAll("span")].find((element) => /^\(\d+건 기준\)$/.test(text(element)));
  const completedLabel = [...root.querySelectorAll("main p")].find((element) => text(element) === "작성함");
  const stats = completedLabel?.parentElement?.querySelectorAll("p");
  const headers = [...section.querySelectorAll<HTMLElement>('[role="columnheader"][aria-sort]')];
  const expanded = new Map<string, HTMLElement[]>();
  const empty = document.createElement("div");
  empty.className = "naeo-panel";
  empty.setAttribute("role", "status");
  empty.style.cssText = "padding:32px;text-align:center;margin:16px 0;color:var(--muted,#a3a3a3)";
  empty.textContent = "조건에 맞는 추천 키워드가 없어요. 다른 필터를 선택해 보세요.";
  empty.hidden = true;
  section.append(empty);

  const syncCompleted = () => {
    for (const input of checkboxes) {
      const name = (input.getAttribute("aria-label") || "").replace(/ 작성 완료 표시$/, "");
      const checked = completed.has(name);
      input.checked = checked;
      attribute(input, "aria-checked", String(checked));
      const wrapper = input.parentElement;
      if (wrapper) {
        remember(wrapper, "class");
        remember(wrapper, "style");
        wrapper.classList.toggle("Mui-checked", checked);
        wrapper.style.color = checked ? "#03c75a" : "";
        const path = wrapper.querySelector("svg path");
        if (path) {
          remember(path, "d");
          path.setAttribute("d", checked ? CHECKED_PATH : originalAttributes.get(path)?.get("d") || "");
        }
      }
    }
    const count = records.filter((record) => completed.has(record.name)).length;
    setText(stats?.[1], String(count));
    setText(stats?.[2], `${Math.round(count / records.length * 100)}%`);
    for (const record of records) attribute(record.row, "aria-label", `${record.name} ${completed.has(record.name) ? "작성 완료" : "미작성"}`);
  };
  const render = () => {
    const filtered = records.filter((record) => filter !== "opportunity" && (period === "전체기간" || record.day >= (period === "이번 주" ? weekStart : monthStart)));
    const visible = new Set(filtered);
    for (const record of records) {
      remember(record.row, "style");
      record.row.style.display = visible.has(record) ? "" : "none";
      if (record.mobileWrapper) {
        remember(record.mobileWrapper, "style");
        record.mobileWrapper.style.display = visible.has(record) ? "" : "none";
      }
    }
    const ordered = [...records].sort((a, b) => {
      const number = (record: Keyword) => Number(record.cells[sortColumn]?.replace(/,/g, "")) || 0;
      return (number(a) - number(b)) * (sortAscending ? 1 : -1);
    });
    for (const record of ordered) {
      rowParent?.append(record.row);
      if (record.mobileWrapper) mobileParent?.append(record.mobileWrapper);
    }
    for (const button of periodButtons) {
      attribute(button, "aria-pressed", String(text(button) === period));
      if (activeClass && inactiveClass) attribute(button, "class", text(button) === period ? activeClass : inactiveClass);
    }
    if (goldenButton) {
      attribute(goldenButton, "aria-pressed", String(filter === "golden"));
      if (activeClass && inactiveClass) attribute(goldenButton, "class", filter === "golden" ? activeClass : inactiveClass);
    }
    for (const [card, selected] of [[goldenCard, filter === "golden"], [opportunityCard, filter === "opportunity"]] as const) {
      if (!card) continue;
      attribute(card, "aria-pressed", String(selected));
      remember(card, "style");
      card.style.outline = selected ? "1px solid #03c75a" : "";
      card.style.outlineOffset = "-1px";
    }
    for (const header of headers) {
      const column = [...header.parentElement!.children].indexOf(header);
      attribute(header, "aria-sort", column === sortColumn ? sortAscending ? "ascending" : "descending" : "none");
      const arrows = header.querySelectorAll<HTMLElement>(".mui-xf3331 > span");
      arrows.forEach((arrow, index) => {
        remember(arrow, "style");
        const color = column === sortColumn && (sortAscending ? index === 0 : index === 1) ? "#03c75a" : "rgba(255,255,255,.2)";
        if (index === 0) arrow.style.borderBottomColor = color; else arrow.style.borderTopColor = color;
      });
      const label = header.querySelector<HTMLElement>(".sort-label");
      if (label) {
        remember(label, "style");
        label.style.color = column === sortColumn ? "#03c75a" : "";
      }
    }
    setText(counter, `(${filtered.length}건 기준)`);
    empty.hidden = filtered.length > 0;
  };
  const toggleDetail = (record: Keyword) => {
    const panels = expanded.get(record.name);
    const opening = !panels;
    if (panels) {
      for (const panel of panels) panel.remove();
      expanded.delete(record.name);
    } else {
      const created: HTMLElement[] = [];
      for (const container of [record.row, record.card]) {
        if (!container) continue;
        const panel = document.createElement("div");
        panel.className = "naeo-panel";
        panel.setAttribute("role", "region");
        panel.setAttribute("aria-label", `${record.name} 키워드 지표`);
        panel.style.cssText = "margin:12px;padding:18px;background:rgba(3,199,90,.04);border:1px solid rgba(3,199,90,.2);border-radius:10px";
        const title = document.createElement("strong");
        title.textContent = `${record.name} 키워드 지표`;
        const description = document.createElement("p");
        description.textContent = "검색량과 문서수를 비교해 글감으로 활용해 보세요.";
        description.style.cssText = "font-size:13px;color:var(--muted,#a3a3a3);margin:8px 0 12px";
        const metrics = document.createElement("dl");
        metrics.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:12px;font-size:13px;margin:0 0 16px";
        for (const [label, index] of [["PC", 3], ["모바일", 4], ["전체 검색량", 5], ["문서수", 6], ["포화도", 7]] as const) {
          const group = document.createElement("div");
          const dt = document.createElement("dt");
          dt.textContent = label;
          dt.style.color = "var(--muted,#a3a3a3)";
          const dd = document.createElement("dd");
          dd.style.cssText = "margin:4px 0 0;font-weight:700";
          dd.textContent = record.cells[index];
          group.append(dt, dd);
          metrics.append(group);
        }
        const links = document.createElement("div");
        links.style.cssText = "display:flex;gap:10px;flex-wrap:wrap";
        for (const [label, href] of [["AI 글쓰기", `/dashboard/write?keyword=${encodeURIComponent(record.name)}`], ["경쟁 블로그 보기", "/dashboard/competitors"]]) {
          const link = document.createElement("a");
          link.className = "naeo-button";
          link.textContent = label;
          link.href = href;
          links.append(link);
        }
        panel.append(title, description, metrics, links);
        container.append(panel);
        created.push(panel);
      }
      expanded.set(record.name, created);
    }
    for (const control of section.querySelectorAll<HTMLElement>("[aria-expanded]")) {
      const label = control.getAttribute("aria-label");
      if (label === `${record.name} 상세보기` || label === `${record.name} 경쟁 분석 보기`) {
        attribute(control, "aria-expanded", String(opening));
        const arrowLabel = control.matches("button") ? control : [...control.querySelectorAll("div")].find((element) => text(element) === "🔍 경쟁 분석 ▼" || text(element) === "🔍 경쟁 분석 ▲");
        if (arrowLabel) setText(arrowLabel, `🔍 경쟁 분석 ${opening ? "▲" : "▼"}`);
      }
    }
  };

  const handleClick = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target;
    const checkbox = target.closest<HTMLInputElement>('input[type="checkbox"]');
    if (checkbox && checkboxes.includes(checkbox)) {
      // The native click must finish so its checked state can produce the change event.
      event.stopPropagation();
      return;
    }
    const button = target.closest<HTMLButtonElement>("button");
    const label = button?.getAttribute("aria-label") || "";
    if (label.endsWith(" 설명") && HELP[label.replace(/ 설명$/, "")]) {
      event.preventDefault();
      const topic = label.replace(/ 설명$/, "");
      tools.openDialog(`${topic} 설명`, <p style={{ lineHeight: 1.8, color: "var(--muted, #a3a3a3)" }}>{HELP[topic]}</p>);
      return;
    }
    if (button && periodButtons.includes(button)) {
      event.preventDefault();
      period = text(button);
      render();
      return;
    }
    const stat = target.closest<HTMLElement>('[role="button"][aria-label]');
    if ((goldenButton && button === goldenButton) || (goldenCard && stat === goldenCard) || (opportunityCard && stat === opportunityCard)) {
      event.preventDefault();
      const selected = stat === opportunityCard ? "opportunity" : "golden";
      filter = filter === selected ? "all" : selected;
      if (button === goldenButton) period = "전체기간";
      render();
      return;
    }
    const header = target.closest<HTMLElement>('[role="columnheader"][aria-sort]');
    if (header && headers.includes(header)) {
      event.preventDefault();
      const column = [...header.parentElement!.children].indexOf(header);
      sortAscending = column === sortColumn ? !sortAscending : false;
      sortColumn = column;
      render();
      return;
    }
    const detail = target.closest<HTMLElement>('[aria-label$=" 상세보기"], [aria-label$=" 경쟁 분석 보기"]');
    if (detail && !target.closest("a")) {
      const name = (detail.getAttribute("aria-label") || "").replace(/ (상세보기|경쟁 분석 보기)$/, "");
      const record = records.find((item) => item.name === name);
      if (record) { event.preventDefault(); toggleDetail(record); }
    }
  };
  const handleChange = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !checkboxes.includes(input)) return;
    event.preventDefault();
    const name = (input.getAttribute("aria-label") || "").replace(/ 작성 완료 표시$/, "");
    if (input.checked) completed.add(name); else completed.delete(name);
    try { localStorage.setItem(COMPLETED_KEY, JSON.stringify([...completed])); } catch { /* Keep in-memory state. */ }
    syncCompleted();
  };
  const handleKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.matches("button, a, input")) return;
    if (target.matches('[role="columnheader"][aria-sort], [role="button"][aria-label^="황금 키워드:"], [role="button"][aria-label^="선점기회:"], [role="button"][aria-label$=" 상세보기"]')) {
      event.preventDefault();
      target.click();
    }
  };
  root.addEventListener("click", handleClick);
  root.addEventListener("change", handleChange);
  root.addEventListener("keydown", handleKey);
  cleanups.push(() => root.removeEventListener("click", handleClick), () => root.removeEventListener("change", handleChange), () => root.removeEventListener("keydown", handleKey));
  syncCompleted();
  return () => {
    cleanups.forEach((cleanup) => cleanup());
    empty.remove();
    expanded.forEach((panels) => panels.forEach((panel) => panel.remove()));
    for (const [element, attributes] of originalAttributes) for (const [name, value] of attributes) {
      if (value === null) element.removeAttribute(name); else element.setAttribute(name, value);
    }
    for (const [element, value] of originalTexts) element.textContent = value;
    for (const { input, checked } of inputsOriginal) input.checked = checked;
    originalRowOrder.forEach((row) => rowParent?.append(row));
    originalMobileOrder.forEach((card) => mobileParent?.append(card));
  };
};
