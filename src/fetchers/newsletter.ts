import type { ContentItem, Env } from "../types";
import { getSources } from "../sources";
import { hashWithPrefix, DEDUP_PREFIX, DEDUP_TTL_SECONDS } from "../util";

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

  // Message-ID 기반 중복 체크
  const rawMessageId = message.headers.get("message-id") ?? message.headers.get("Message-ID");
  const dedupeKey = await hashWithPrefix(rawMessageId ?? `${from}:${subject}`, DEDUP_PREFIX.MESSAGE_ID);

  const alreadySeen = await env.DEDUP_KV.get(dedupeKey);
  if (alreadySeen) return;

  await env.DEDUP_KV.put(dedupeKey, "1", { expirationTtl: DEDUP_TTL_SECONDS });

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
  const since = Date.now() - 24 * 60 * 60 * 1000; // 24시간

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
