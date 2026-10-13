"use client";
import type { InstallBehavior } from "@/lib/behavior";
import { api } from "@/lib/api-client";

/** /dashboard/mate: 내 무료 진단 기록 삭제(확인 후 서버 삭제, 성공하면 목록 새로고침). */
export const installMateHistory: InstallBehavior = (root, tools) => {
  const click = (event: MouseEvent) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-mate-delete]") : null;
    if (!button || !root.contains(button)) return;
    event.preventDefault();
    if (!window.confirm("이 진단 기록을 삭제할까요? 공유 링크도 더 이상 열리지 않습니다.")) return;
    button.disabled = true;
    api(`/api/mate/reports/${button.dataset.mateDelete}`, { method: "DELETE" })
      .then(() => { tools.toast("진단 기록을 삭제했습니다."); window.location.reload(); })
      .catch(error => { button.disabled = false; tools.toast(error instanceof Error ? error.message : "삭제하지 못했습니다."); });
  };
  root.addEventListener("click", click);
  return () => root.removeEventListener("click", click);
};
