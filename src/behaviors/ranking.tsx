import type { InstallBehavior } from "@/lib/behavior";
import { text } from "@/lib/behavior";

/** Adds local interactions to the captured leaderboard without calling NAEO APIs. */
export const installRanking: InstallBehavior = (root, tools) => {
  const table = root.querySelector<HTMLElement>(".mui-tnkwu5");
  const header = table?.querySelector<HTMLElement>(":scope > .mui-u4hvp9");
  if (!table || !header) return;

  const originalAttributes = new Map<Element, Map<string, string | null>>();
  const remember = (element: Element, name: string) => {
    if (!originalAttributes.has(element)) originalAttributes.set(element, new Map());
    const attributes = originalAttributes.get(element)!;
    if (!attributes.has(name)) attributes.set(name, element.getAttribute(name));
  };
  const attribute = (element: Element, name: string, value: string) => {
    remember(element, name);
    element.setAttribute(name, value);
  };
  const style = (element: HTMLElement, values: Partial<CSSStyleDeclaration>) => {
    remember(element, "style");
    Object.assign(element.style, values);
  };
  const rows = [...table.children]
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== header)
    .map((element, index) => ({
      element,
      index,
      topics: text(element.querySelector(".mui-yjsvyy")).split(/\s*,\s*/).filter(Boolean),
      mate: Boolean(element.querySelector('[aria-label^="네이버 공식 메이트"]')),
      metrics: [...element.children].slice(2).map(cell => Number(text(cell).replace(/[^\d.-]/g, "")) || 0),
    }));
  const allButtons = [...root.querySelectorAll<HTMLButtonElement>("button")];
  const topicButtons = allButtons.filter(button =>
    button.classList.contains("mui-2kdv1m") || button.classList.contains("mui-19dnvw9"));
  const topicName = (button: HTMLElement) => text(button).replace(/\s*·\s*[\d,]+$/, "").trim();
  const topics = [...new Set(topicButtons.map(topicName))];
  const selectedTopicClass = topicButtons.find(button => topicName(button) === "전체")?.className;
  const unselectedTopicClass = topicButtons.find(button => topicName(button) !== "전체")?.className;
  const topicDialogButton = allButtons.find(button => text(button) === "전체 분야");
  const mateButton = allButtons.find(button => text(button) === "네이버 메이트만");
  const periodTabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tablist"][aria-label="랭킹 기간 선택"] [role="tab"]')];
  const selectedTabClass = periodTabs.find(tab => tab.getAttribute("aria-selected") === "true")?.className;
  const unselectedTabClass = periodTabs.find(tab => tab.getAttribute("aria-selected") !== "true")?.className;
  const sortHeaders = [...header.children].slice(2) as HTMLElement[];
  const moreButton = allButtons.find(button => /^200명\s*더보기$/.test(text(button)));
  const topicDialogText = topicDialogButton ? [...topicDialogButton.childNodes].find(node => node.nodeType === Node.TEXT_NODE) : null;
  const originalTopicText = topicDialogText?.textContent ?? null;
  let selectedTopic = "전체";
  // 서버가 mate=1로 그린 화면이면 버튼의 aria-pressed가 이미 true다.
  let mateOnly = mateButton?.getAttribute("aria-pressed") === "true";
  let sortIndex = 0;
  let descending = true;
  // 서버가 그린 화면이면 선택된 탭이 현재 기간이다.
  let period = periodTabs.find(tab => tab.getAttribute("aria-selected") === "true")?.textContent?.trim() || "전체 랭킹";
  const serverRendered = periodTabs.some(tab => tab.dataset.period);

  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.style.cssText = "margin:12px 0;color:var(--muted,#a3a3a3);font-size:13px;line-height:1.6;display:none";
  table.before(status);
  const empty = document.createElement("div");
  empty.style.cssText = "padding:56px 24px;text-align:center;color:var(--muted,#a3a3a3);font-size:14px;display:none";
  empty.textContent = "이 조건에 해당하는 블로그가 없습니다. 분야나 메이트 필터를 변경해 보세요.";
  table.after(empty);

  const visibleRows = () => rows.filter(row =>
    (selectedTopic === "전체" || (selectedTopic === "미설정" ? !row.topics.length : row.topics.includes(selectedTopic))) &&
    (!mateOnly || row.mate));
  const periodDescription = () => {
    const now = new Date();
    if (period === "월간 랭킹") return `${now.getFullYear()}년 ${now.getMonth() + 1}월`;
    if (period === "주간 랭킹") {
      const monday = new Date(now);
      monday.setDate(now.getDate() - (now.getDay() + 6) % 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return `${monday.getMonth() + 1}.${monday.getDate()} ~ ${sunday.getMonth() + 1}.${sunday.getDate()}`;
    }
    return "전체 기간";
  };
  const update = () => {
    const matching = visibleRows();
    const visible = new Set(matching.map(row => row.element));
    const sorted = [...rows].sort((a, b) =>
      ((a.metrics[sortIndex] - b.metrics[sortIndex]) * (descending ? -1 : 1)) || a.index - b.index);
    for (const row of sorted) {
      style(row.element, { display: visible.has(row.element) ? "" : "none" });
      table.append(row.element);
    }
    for (const button of topicButtons) {
      const selected = topicName(button) === selectedTopic;
      attribute(button, "aria-pressed", String(selected));
      const className = selected ? selectedTopicClass : unselectedTopicClass;
      if (className) attribute(button, "class", className);
    }
    if (topicDialogText) topicDialogText.textContent = selectedTopic === "전체" ? "전체 분야" : selectedTopic;
    if (mateButton) {
      attribute(mateButton, "aria-pressed", String(mateOnly));
      style(mateButton, { background: mateOnly ? "#03c75a" : "", color: mateOnly ? "#fff" : "" });
    }
    for (const tab of periodTabs) {
      const selected = text(tab) === period;
      attribute(tab, "aria-selected", String(selected));
      attribute(tab, "tabindex", selected ? "0" : "-1");
      const className = selected ? selectedTabClass : unselectedTabClass;
      if (className) attribute(tab, "class", className);
    }
    for (const [index, cell] of sortHeaders.entries()) {
      attribute(cell, "aria-sort", index === sortIndex ? (descending ? "descending" : "ascending") : "none");
      const label = cell.querySelector<HTMLElement>(".sort-label");
      if (label) style(label, { color: index === sortIndex ? "#03c75a" : "#a3a3a3" });
      const arrow = cell.querySelector<HTMLElement>(".mui-1prphp3");
      if (arrow) style(arrow, { opacity: index === sortIndex ? "1" : ".4", transform: index === sortIndex && !descending ? "rotate(180deg)" : "" });
    }
    status.style.display = "block";
    status.textContent = `${selectedTopic === "전체" ? "전체 분야" : selectedTopic}${mateOnly ? " · 네이버 메이트" : ""} · ${serverRendered ? "" : "저장된 "}${rows.length}명 중 ${matching.length}명` +
      (serverRendered || period === "전체 랭킹" ? "" : ` · ${periodDescription()} ${period} 미리보기 — 공개 캡처의 전체 랭킹 기록을 표시합니다.`);
    empty.style.display = matching.length ? "none" : "block";
    if (moreButton) style(moreButton, { display: matching.length === rows.length ? "" : "none" });
  };

  const chooseTopic = (topic: string) => {
    selectedTopic = topic;
    update();
  };
  const openTopics = () => tools.openDialog("분야 선택", <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
    {topics.map(topic => <button key={topic} type="button" aria-pressed={topic === selectedTopic}
      style={{ border: "1px solid var(--border,rgba(255,255,255,.1))", borderRadius: 6, padding: "7px 12px", fontSize: 13, background: topic === selectedTopic ? "#03c75a" : "transparent", color: topic === selectedTopic ? "#fff" : "inherit" }}
      onClick={() => { chooseTopic(topic); tools.closeDialog(); }}>{topic}</button>)}
  </div>);
  const scrollTo = (element: HTMLElement | null) => {
    if (!element) return;
    element.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    attribute(element, "tabindex", "-1");
    element.focus({ preventScroll: true });
  };

  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    const target = event.target;
    const button = target.closest<HTMLButtonElement>("button");
    if (button && topicButtons.includes(button)) {
      event.preventDefault(); chooseTopic(topicName(button)); return;
    }
    if (button === topicDialogButton) {
      event.preventDefault(); openTopics(); return;
    }
    if (button === mateButton) {
      event.preventDefault();
      if (serverRendered) {
        const url = new URL(window.location.href);
        if (mateOnly) url.searchParams.delete("mate"); else url.searchParams.set("mate", "1");
        tools.navigate(url.pathname + url.search); return;
      }
      mateOnly = !mateOnly; update(); return;
    }
    if (button && periodTabs.includes(button)) {
      event.preventDefault();
      if (button.dataset.period) { tools.navigate(`/ranking?period=${button.dataset.period}${mateOnly ? "&mate=1" : ""}`); return; }
      period = text(button); update(); return;
    }
    if (button === moreButton) {
      event.preventDefault();
      tools.openDialog("저장된 랭킹", <div>
        <p>공개 페이지에서 확인한 상위 {rows.length}명의 랭킹을 모두 표시하고 있습니다.</p>
        <p style={{ color: "var(--muted,#a3a3a3)", fontSize: 14 }}>분야, 메이트 여부, 점수 항목으로 이 기록을 살펴볼 수 있어요.</p>
        <button className="naeo-button button" type="button" onClick={() => { tools.closeDialog(); scrollTo(header); }}>랭킹 살펴보기</button>
      </div>);
      return;
    }
    if (button && text(button) === "내 순위 보러가기") {
      event.preventDefault(); scrollTo(root.querySelector<HTMLElement>("#my-rank")); return;
    }
    const scoringLink = target.closest<HTMLAnchorElement>('a[href$="#scoring-criteria"]');
    if (scoringLink) {
      event.preventDefault(); scrollTo(root.querySelector<HTMLElement>("#scoring-criteria")); return;
    }
    const sortCell = sortHeaders.find(cell => cell.contains(target));
    if (sortCell) {
      event.preventDefault();
      const index = sortHeaders.indexOf(sortCell);
      descending = index === sortIndex ? !descending : true;
      sortIndex = index;
      update();
      return;
    }
    const badge = target.closest<HTMLElement>('[aria-label^="칭호:"], [aria-label^="네이버 공식 메이트"]');
    if (badge) {
      event.preventDefault();
      const description = badge.getAttribute("aria-label") || "";
      const firstStop = description.indexOf(". ");
      tools.openDialog(firstStop > 0 ? description.slice(0, firstStop).replace(/^칭호:\s*/, "") : "네이버 메이트",
        <p style={{ margin: 0, lineHeight: 1.8 }}>{firstStop > 0 ? description.slice(firstStop + 2) : description}</p>);
    }
  };
  const keydown = (event: KeyboardEvent) => {
    if (!(event.target instanceof HTMLElement)) return;
    const target = event.target;
    if (periodTabs.includes(target as HTMLButtonElement) && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const current = periodTabs.indexOf(target as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? periodTabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + periodTabs.length) % periodTabs.length;
      periodTabs[next].focus();
      periodTabs[next].click();
    } else if ((event.key === "Enter" || event.key === " ") &&
      (sortHeaders.includes(target) || target.matches('[aria-label^="칭호:"], [aria-label^="네이버 공식 메이트"]'))) {
      event.preventDefault(); target.click();
    }
  };

  for (const cell of sortHeaders) {
    attribute(cell, "tabindex", "0");
    attribute(cell, "role", "columnheader");
    attribute(cell, "aria-sort", cell === sortHeaders[0] ? "descending" : "none");
    const description = cell.getAttribute("aria-label");
    if (description) attribute(cell, "title", description);
  }
  for (const badge of root.querySelectorAll<HTMLElement>('[aria-label^="칭호:"], [aria-label^="네이버 공식 메이트"]')) {
    attribute(badge, "role", "button");
    attribute(badge, "title", badge.getAttribute("aria-label") || "");
  }
  for (const button of topicButtons) attribute(button, "aria-pressed", String(topicName(button) === "전체"));
  root.addEventListener("click", click);
  root.addEventListener("keydown", keydown);
  return () => {
    root.removeEventListener("click", click);
    root.removeEventListener("keydown", keydown);
    status.remove();
    empty.remove();
    for (const row of rows) table.append(row.element);
    if (topicDialogText) topicDialogText.textContent = originalTopicText;
    for (const [element, attributes] of originalAttributes) {
      for (const [name, value] of attributes) {
        if (value === null) element.removeAttribute(name); else element.setAttribute(name, value);
      }
    }
  };
};
