// ============================================================
// 구독 소스 — D1 기반 CRUD
// 텔레그램 봇 명령어로 추가/삭제/조회
// ============================================================

import type { Env } from "./types";
import { fetchWithTimeout } from "./util";

export interface SourceRecord {
  id: number;
  type: "newsletter" | "youtube";
  name: string;
  identifier: string; // newsletter: 발신 이메일 | youtube: channelId
  language: "ko" | "en";
  active: number;
}

/** 활성 소스 목록 반환 */
export async function getSources(env: Env): Promise<{
  newsletters: Array<{ name: string; emailFrom: string; language: "ko" | "en" }>;
  youtube: Array<{ name: string; channelId: string; language: "ko" | "en" }>;
}> {
  const { results } = await env.ARCHIVE_DB.prepare(
    "SELECT * FROM sources WHERE active = 1 ORDER BY created_at ASC"
  ).all<SourceRecord>();

  return {
    newsletters: results
      .filter((r) => r.type === "newsletter")
      .map((r) => ({ name: r.name, emailFrom: r.identifier, language: r.language })),
    youtube: results
      .filter((r) => r.type === "youtube")
      .map((r) => ({ name: r.name, channelId: r.identifier, language: r.language })),
  };
}

/** 전체 소스 목록 반환 (비활성 포함) */
export async function listAllSources(env: Env): Promise<SourceRecord[]> {
  const { results } = await env.ARCHIVE_DB.prepare(
    "SELECT * FROM sources ORDER BY type, created_at ASC"
  ).all<SourceRecord>();
  return results;
}

/** 뉴스레터 소스 추가 (이메일 기반) */
export async function addNewsletterSource(
  name: string,
  emailFrom: string,
  language: "ko" | "en",
  env: Env
): Promise<void> {
  await env.ARCHIVE_DB.prepare(
    "INSERT INTO sources (type, name, identifier, language, active, created_at) VALUES ('newsletter', ?, ?, ?, 1, ?)"
  )
    .bind(name, emailFrom.toLowerCase(), language, Date.now())
    .run();
}

/** 유튜브 소스 추가 */
export async function addYoutubeSource(
  name: string,
  channelId: string,
  language: "ko" | "en",
  env: Env
): Promise<void> {
  await env.ARCHIVE_DB.prepare(
    "INSERT INTO sources (type, name, identifier, language, active, created_at) VALUES ('youtube', ?, ?, ?, 1, ?)"
  )
    .bind(name, channelId, language, Date.now())
    .run();
}

/** 소스 삭제 (이름으로) */
export async function removeSource(name: string, env: Env): Promise<boolean> {
  const result = await env.ARCHIVE_DB.prepare(
    "DELETE FROM sources WHERE name = ?"
  )
    .bind(name)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** YouTube URL/핸들 → channelId + 채널명 자동 조회 */
export async function resolveYoutubeChannel(
  input: string,
  apiKey: string
): Promise<{ channelId: string; name: string; language: "ko" | "en" }> {
  // youtube.com/channel/UCxxxx 형식
  const directMatch = input.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  if (directMatch) {
    return fetchChannelById(directMatch[1], apiKey);
  }

  // 이미 UCxxxx 형식
  if (/^UC[\w-]{22}$/.test(input)) {
    return fetchChannelById(input, apiKey);
  }

  // youtube.com/@handle 또는 @handle 또는 handle
  let handle = input;
  const urlMatch = input.match(/youtube\.com\/@([\w가-힣\-_.]+)/);
  if (urlMatch) handle = urlMatch[1];
  if (!handle.startsWith("@")) handle = "@" + handle;

  const params = new URLSearchParams({ part: "snippet", forHandle: handle, key: apiKey });
  const res = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/channels?${params}`, {}, 15000);
  const data = (await res.json()) as { items?: Array<{ id: string; snippet: { title: string; defaultAudioLanguage?: string; country?: string } }> };

  if (!data.items?.length) throw new Error(`채널을 찾을 수 없어요: ${input}`);

  const item = data.items[0];
  const language = detectLanguage(item.snippet.defaultAudioLanguage, item.snippet.country);
  return { channelId: item.id, name: item.snippet.title, language };
}

async function fetchChannelById(
  channelId: string,
  apiKey: string
): Promise<{ channelId: string; name: string; language: "ko" | "en" }> {
  const params = new URLSearchParams({ part: "snippet", id: channelId, key: apiKey });
  const res = await fetchWithTimeout(`https://www.googleapis.com/youtube/v3/channels?${params}`, {}, 15000);
  const data = (await res.json()) as { items?: Array<{ id: string; snippet: { title: string; defaultAudioLanguage?: string; country?: string } }> };

  if (!data.items?.length) throw new Error(`채널을 찾을 수 없어요: ${channelId}`);

  const item = data.items[0];
  const language = detectLanguage(item.snippet.defaultAudioLanguage, item.snippet.country);
  return { channelId: item.id, name: item.snippet.title, language };
}

function detectLanguage(audioLang?: string, country?: string): "ko" | "en" {
  if (audioLang?.startsWith("ko") || country === "KR") return "ko";
  return "en";
}
