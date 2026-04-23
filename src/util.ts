// ============================================================
// 공통 유틸리티
// ============================================================

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
