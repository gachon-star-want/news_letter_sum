// ============================================================
// 공통 유틸리티
// ============================================================

// 상수
export const DEDUP_TTL_SECONDS = 30 * 24 * 60 * 60;
export const DEDUP_PREFIX = { URL: "seen:", MESSAGE_ID: "msgid:" } as const;
export const CONFIDENCE_THRESHOLD = 0.75;

/** SHA-256 해시 생성 (prefix + 길이 제어) */
export async function hashWithPrefix(raw: string, prefix: string, length: number = 32): Promise<string> {
  const data = new TextEncoder().encode(raw.trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return prefix + hex.slice(0, length);
}

/** Telegram/HTML 특수문자 이스케이프 (텍스트 + 속성값 모두 안전) */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** AbortController 기반 fetch timeout */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = 20000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** KST 기준 오늘 날짜 YYYY-MM-DD */
export function todayKST(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** FTS5 쿼리 안전화 — 특수문자 제거 후 phrase 검색으로 변환 */
export function sanitizeFTSQuery(keyword: string): string {
  const cleaned = keyword.replace(/["'*^:()\-+]/g, " ").trim();
  return cleaned ? `"${cleaned}"` : "";
}
