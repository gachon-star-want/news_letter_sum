import type { Env } from "./types";
import { hashWithPrefix, DEDUP_TTL_SECONDS, DEDUP_PREFIX } from "./util";

/** URL의 해시 (KV 키로 사용) */
async function hashUrl(url: string): Promise<string> {
  return hashWithPrefix(url, DEDUP_PREFIX.URL);
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
  await env.DEDUP_KV.put(key, new Date().toISOString(), { expirationTtl: DEDUP_TTL_SECONDS });
}

/** 일반 키 기반 중복 체크 (Message-ID 등) */
export async function isKeyProcessed(key: string, env: Env): Promise<boolean> {
  return (await env.DEDUP_KV.get(key)) !== null;
}

/** 일반 키를 처리 완료로 표시 */
export async function markKeyProcessed(key: string, env: Env, ttlSeconds: number = DEDUP_TTL_SECONDS): Promise<void> {
  await env.DEDUP_KV.put(key, new Date().toISOString(), { expirationTtl: ttlSeconds });
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
