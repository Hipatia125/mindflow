import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn/ui 推荐的 className 合并工具
 * 用法：cn("base-class", condition && "extra-class", props.className)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 生成简单的 UUID（前端临时 id 用）
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * 将 Date 转为 ISO 格式日期字符串（YYYY-MM-DD，本地时区）
 */
export function toDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 返回今日的 YYYY-MM-DD
 */
export function todayISO(): string {
  return toDateISO(new Date());
}

/**
 * 格式化分钟为 "Xh Ym" 或 "Ym" 的友好字符串
 */
export function formatMinutes(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return "0分钟";
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  if (hours === 0) return `${mins}分钟`;
  if (mins === 0) return `${hours}小时`;
  return `${hours}小时${mins}分`;
}

/**
 * 秒数 → MM:SS 格式（计时器显示）
 */
export function formatMMSS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/**
 * 在 YYYY-MM-DD 上加 / 减 N 天，返回新的 ISO 日期（本地时区）
 */
export function shiftDateISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateISO(d);
}

/**
 * 返回 "M月D日" 本地月日表达（例：8月23日）
 * 输入 YYYY-MM-DD，不带时区换算偏移
 */
export function formatDateMD(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  // 去掉月份/日期的前置 0
  const mm = Number(m);
  const dd = Number(d);
  return `${mm}月${dd}日`;
}

/**
 * 两个 YYYY-MM-DD 之间的天数差（b - a），返回整数
 */
export function daysBetween(aISO: string, bISO: string): number {
  if (!aISO || !bISO) return 0;
  const MS = 24 * 3600 * 1000;
  const a = new Date(`${aISO.slice(0, 10)}T00:00:00`).getTime();
  const b = new Date(`${bISO.slice(0, 10)}T00:00:00`).getTime();
  return Math.round((b - a) / MS);
}
