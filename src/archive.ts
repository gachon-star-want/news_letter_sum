import type { Env, SummaryItem } from "./types";
import { sanitizeFTSQuery } from "./util";

interface SummaryRow {
  id: number;
  date: string;
  source_type: string;
  source_name: string;
  title: string;
  summary_ko: string;
  url: string;
  created_at: number;
}

/** 요약 결과를 D1에 저장 */
export async function saveSummaries(items: SummaryItem[], env: Env): Promise<void> {
  if (!items.length) return;

  const now = Math.floor(Date.now() / 1000);
  const stmt = env.ARCHIVE_DB.prepare(`
    INSERT OR IGNORE INTO summaries
      (date, source_type, source_name, title, summary_ko, url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  await env.ARCHIVE_DB.batch(
    items.map((item) =>
      stmt.bind(item.date, item.sourceType, item.sourceName, item.title, item.summaryKo, item.url, now)
    )
  );
}

/** 키워드 전문검색 (FTS5) */
export async function searchSummaries(
  keyword: string,
  env: Env,
  limit: number = 10
): Promise<SummaryRow[]> {
  const query = sanitizeFTSQuery(keyword);
  if (!query) return [];

  const { results } = await env.ARCHIVE_DB.prepare(`
    SELECT s.id, s.date, s.source_type, s.source_name, s.title, s.summary_ko, s.url, s.created_at
    FROM summaries_fts
    JOIN summaries s ON summaries_fts.rowid = s.id
    WHERE summaries_fts MATCH ?
    ORDER BY s.created_at DESC
    LIMIT ?
  `)
    .bind(query, limit)
    .all<SummaryRow>();

  return results;
}

/** 30일 지난 데이터 정리 */
export async function cleanupOldData(env: Env): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  await env.ARCHIVE_DB.prepare(`DELETE FROM summaries WHERE date < ?`)
    .bind(cutoffDate)
    .run();

  await env.ARCHIVE_DB.prepare(
    `DELETE FROM pending_emails WHERE received_at < ? AND processed = 1`
  )
    .bind(cutoff.getTime())
    .run();

  await env.ARCHIVE_DB.prepare(`INSERT INTO summaries_fts(summaries_fts) VALUES('optimize')`)
    .run()
    .catch(() => {});
}
