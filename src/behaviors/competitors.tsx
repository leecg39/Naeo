"use client";
import type { InstallBehavior } from "@/lib/behavior";
import { api } from "@/lib/api-client";

type Snapshot = { report: { score: number } } | null;
/** /dashboard/competitors: 경쟁 블로그 추가·갱신·메모·삭제. 성공하면 서버가 다시 그린 화면으로 새로고침한다. */
export const installCompetitorsPage: InstallBehavior = (root, tools) => {
  let busy = false;
  const run = async (action: () => Promise<string>) => {
    if (busy) return;
    busy = true;
    try { tools.toast(await action()); window.location.reload(); }
    catch (error) { tools.toast(error instanceof Error ? error.message : "처리하지 못했습니다."); }
    finally { busy = false; }
  };
  const submit = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || (!form.hasAttribute("data-competitor-add") && !form.hasAttribute("data-exposure-form"))) return;
    event.preventDefault();
    const data = new FormData(form);
    if (form.hasAttribute("data-competitor-add")) void run(async () => {
      await api("/api/competitors", { method: "POST", body: { blog: String(data.get("blog") || ""), note: String(data.get("note") || "") } });
      return "경쟁 블로그를 추가했습니다. '갱신'을 눌러 공개 글을 수집하세요.";
    });
    if (form.hasAttribute("data-exposure-form")) void run(async () => {
      const keyword = String(data.get("keyword") || "").trim();
      const result = await api<{ hits: { kind: string }[] }>("/api/exposures", { method: "POST", body: { keyword } });
      const mine = result.hits.filter(h => h.kind === "mine").length, comp = result.hits.filter(h => h.kind === "competitor").length;
      return `"${keyword}" 상위 노출: 내 블로그 ${mine}개 · 경쟁 ${comp}개`;
    });
  };
  const click = (event: MouseEvent) => {
    const control = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-action]") : null;
    const row = control?.closest<HTMLElement>("tr[data-competitor-id]");
    if (!control || !row || !root.contains(row)) return;
    event.preventDefault();
    const id = row.dataset.competitorId, version = Number(row.dataset.version);
    const name = row.getAttribute("aria-label")?.replace(/^경쟁 블로그 /, "") || "";
    if (control.dataset.action === "refresh") void run(async () => {
      control.disabled = true; control.textContent = "수집 중…";
      const result = await api<{ snapshot: Snapshot }>(`/api/competitors/${id}/refresh`, { method: "POST", body: {} });
      return `${name} 수집 완료 · 진단 점수 ${result.snapshot?.report.score ?? 0}점`;
    }).finally(() => { control.disabled = false; control.textContent = "갱신"; });
    if (control.dataset.action === "note") {
      const note = window.prompt(`${name} 메모 (최대 500자)`, row.dataset.note || "");
      if (note === null) return;
      void run(async () => { await api(`/api/competitors/${id}`, { method: "PATCH", body: { note, version } }); return "메모를 저장했습니다."; });
    }
    if (control.dataset.action === "delete") {
      if (!window.confirm(`${name}을(를) 경쟁 블로그에서 삭제할까요?`)) return;
      void run(async () => { await api(`/api/competitors/${id}`, { method: "DELETE", body: { version } }); return "경쟁 블로그를 삭제했습니다."; });
    }
  };
  root.addEventListener("submit", submit);
  root.addEventListener("click", click);
  return () => { root.removeEventListener("submit", submit); root.removeEventListener("click", click); };
};
