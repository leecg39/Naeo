import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export const number = (value: number) => value.toLocaleString("ko-KR");
export function localHref(href: string): string { try { const url = new URL(href,"https://www.naeo.kr"); return ["www.naeo.kr","naeo.kr"].includes(url.hostname) ? url.pathname+url.search+url.hash : href; } catch { return href; } }
