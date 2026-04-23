import type { ContentItem, Env } from "../types";
import { getSources } from "../sources";
import { fetchWithTimeout } from "../util";

/**
 * Cloudflare Email Worker 수신 핸들러
 * Cloudflare Email Routing → 이 Worker로 이메일이 도착하면 D1에 저장
 */
export async function handleIncomingEmail(
  message: ForwardableEmailMessage,
  env: Env
): Promise<void> {
  const from = message.from.toLowerCase();
  const subject = message.headers.get("subject") ?? "(제목 없음)";

  const { newsletters } = await getSources(env);
  const source = newsletters.find((s) => s.emailFrom.toLowerCase() === from);

  if (!source) return;

  const rawText = await streamToText(message.raw);
  const body = extractPlainText(rawText).slice(0, 8000);

  await env.ARCHIVE_DB.prepare(`
    INSERT INTO pending_emails (source_name, subject, body, language, received_at, processed)
    VALUES (?, ?, ?, ?, ?, 0)
  `)
    .bind(source.name, subject, body, source.language, Date.now())
    .run();
}

/** Cron 시점에 미처리 이메일을 D1에서 읽어서 ContentItem 으로 변환 */
export async function fetchPendingNewsletters(env: Env): Promise<ContentItem[]> {
  const since = Date.now() - 25 * 60 * 60 * 1000;

  const { results } = await env.ARCHIVE_DB.prepare(`
    SELECT id, source_name, subject, body, language, received_at
    FROM pending_emails
    WHERE processed = 0 AND received_at >= ?
    ORDER BY received_at ASC
  `)
    .bind(since)
    .all<{
      id: number;
      source_name: string;
      subject: string;
      body: string;
      language: string;
      received_at: number;
    }>();

  if (!results.length) return [];

  const ids = results.map((r) => r.id);
  await env.ARCHIVE_DB.prepare(
    `UPDATE pending_emails SET processed = 1 WHERE id IN (${ids.map(() => "?").join(",")})`
  )
    .bind(...ids)
    .run();

  return results.map((r) => ({
    sourceType: "newsletter" as const,
    sourceName: r.source_name,
    title: r.subject,
    url: `email:${r.source_name}:${r.received_at}`,
    body: r.body,
    publishedAt: new Date(r.received_at),
    language: (r.language as "ko" | "en") ?? "ko",
  }));
}

/** 등록된 RSS 피드 전체 수집 */
export async function fetchRssNewsletters(env: Env): Promise<ContentItem[]> {
  const { rssFeeds } = await getSources(env);
  if (!rssFeeds.length) return [];

  const results = await Promise.allSettled(
    rssFeeds.map((s) => fetchOneFeed(s.name, s.rssUrl, s.language))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<ContentItem[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);
}

async function fetchOneFeed(
  name: string,
  rssUrl: string,
  language: "ko" | "en"
): Promise<ContentItem[]> {
  const res = await fetchWithTimeout(rssUrl, {}, 15000);
  if (!res.ok) throw new Error(`RSS fetch failed (${res.status}): ${rssUrl}`);
  const xml = await res.text();
  return parseRssItems(xml, name, language);
}

function parseRssItems(xml: string, sourceName: string, language: "ko" | "en"): ContentItem[] {
  const since = Date.now() - 25 * 60 * 60 * 1000;
  const items: ContentItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = decodeEntities(extractTag(block, "title"));
    const link = extractTag(block, "link");
    const pubDate = extractTag(block, "pubDate");
    const raw = extractTag(block, "content:encoded") || extractTag(block, "description");

    if (!title || !link) continue;

    const publishedAt = pubDate ? new Date(pubDate) : new Date();
    if (isNaN(publishedAt.getTime()) || publishedAt.getTime() < since) continue;

    items.push({
      sourceType: "newsletter" as const,
      sourceName,
      title,
      url: link.trim(),
      body: stripHtml(raw || title).slice(0, 8000),
      publishedAt,
      language,
    });
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  const escaped = tag.replace(":", "\\:");
  const re = new RegExp(
    `<${escaped}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))`,
    "i"
  );
  const m = xml.match(re);
  if (!m) return "";
  return (m[1] ?? m[2] ?? "").trim();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

async function streamToText(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    total.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(total);
}

function extractPlainText(raw: string): string {
  const noHtml = raw.replace(/<[^>]+>/g, " ");
  return noHtml.replace(/\s+/g, " ").trim();
}
