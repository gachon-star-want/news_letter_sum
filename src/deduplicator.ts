import type { Env } from "./types";

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30일

/** URL의 간단한 해시 (KV 키로 사용) */
async function hashUrl(url: string): Promise<string> {
  const data = new TextEncoder().encode(url);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return "seen:" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** 이미 발송한 URL인지 확인 */
export async function isSeen(url: string, env: Env): Promise<boolean> {
  const key = await hashUrl(url);
  const value = await env.DEDUP_KV.get(key);
  return value !== null;
}

/** URL을 발송 완료로 표시 */
export async function markSeen(url: string, env: Env): Promise<void> {
  const key = await hashUrl(url);
  await env.DEDUP_KV.put(key, new Date().toISOString(), { expirationTtl: TTL_SECONDS });
}

/** 여러 URL을 한번에 중복 필터링 */
export async function filterSeen<T extends { url: string }>(
  items: T[],
  env: Env
): Promise<T[]> {
  const results = await Promise.all(
    items.map(async (item) => ({
      item,
      seen: await isSeen(item.url, env),
    }))
  );
  return results.filter((r) => !r.seen).map((r) => r.item);
}

/** 발송된 항목들의 URL 일괄 등록 */
export async function markAllSeen<T extends { url: string }>(
  items: T[],
  env: Env
): Promise<void> {
  await Promise.all(items.map((item) => markSeen(item.url, env)));
}
