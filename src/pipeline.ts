import type { ContentItem, Env, SummaryItem } from "./types";
import { getSources } from "./sources";
import { fetchYoutubeVideos } from "./fetchers/youtube";
import { fetchPendingNewsletters, fetchRssNewsletters } from "./fetchers/newsletter";
import { filterSeen, markAllSeen } from "./deduplicator";
import { summarizeWithFallback } from "./summarizer/index";
import { saveSummaries, cleanupOldData } from "./archive";
import { formatDailyDigest } from "./formatter";
import { sendToMe, sendError } from "./telegram";
import { todayKST } from "./util";

/** 매일 07:30 KST Cron 트리거 → 여기서 전체 파이프라인 실행 */
export async function runDailyPipeline(env: Env): Promise<void> {
  const today = todayKST();

  const maxItems = parseInt(env.MAX_ITEMS_PER_SOURCE ?? "5", 10);

  try {
    // ① 소스 목록 + 콘텐츠 수집 병렬 실행
    const sources = await getSources(env);
    const [youtubeItems, emailItems, rssItems] = await Promise.all([
      fetchAllYoutube(sources.youtube, env, maxItems),
      fetchPendingNewsletters(env),
      fetchRssNewsletters(env),
    ]);
    const newsletterItems = [...emailItems, ...rssItems];

    const allItems: ContentItem[] = [...youtubeItems, ...newsletterItems];

    // ② 중복 제거
    const newItems = await filterSeen(allItems, env);

    if (!newItems.length) {
      await sendToMe(`📰 <b>오늘의 소식 (${today})</b>\n\n오늘은 새 소식이 없어요.`, env);
      return;
    }

    // ③ 요약 — 동시 최대 5개
    const summaries = await summarizeAll(newItems, today, env);

    // ④ 아카이브 저장 + 중복 표시 병렬
    await Promise.all([
      saveSummaries(summaries, env),
      markAllSeen(newItems, env),
    ]);

    // ⑤ 텔레그램 발송
    const message = formatDailyDigest(summaries, today);
    await sendToMe(message, env);

    // ⑥ 30일 지난 데이터 정리 (매주 월요일)
    if (new Date().getDay() === 1) {
      await cleanupOldData(env).catch(() => {});
    }
  } catch (err) {
    await sendError(err, `runDailyPipeline (${today})`, env);
    throw err;
  }
}

/** DB에서 읽어온 유튜브 채널 목록으로 병렬 수집 */
async function fetchAllYoutube(
  channels: Array<{ name: string; channelId: string; language: "ko" | "en" }>,
  env: Env,
  maxItems: number
): Promise<ContentItem[]> {
  if (!channels.length) return [];

  const results = await Promise.allSettled(
    channels.map((ch) =>
      fetchYoutubeVideos(ch.channelId, ch.name, ch.language, env.YOUTUBE_API_KEY, maxItems)
    )
  );

  return results
    .filter((r): r is PromiseFulfilledResult<ContentItem[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);
}

/** 콘텐츠 요약 (동시 최대 5개) */
async function summarizeAll(items: ContentItem[], date: string, env: Env): Promise<SummaryItem[]> {
  const CONCURRENCY = 5;
  const results: SummaryItem[] = [];

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((item) => summarizeOne(item, date, env))
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled") results.push(r.value);
    }
  }

  return results;
}

async function summarizeOne(item: ContentItem, date: string, env: Env): Promise<SummaryItem> {
  const summaryKo = await summarizeWithFallback(item.body, item.language, env);
  return {
    sourceType: item.sourceType,
    sourceName: item.sourceName,
    title: item.title,
    summaryKo,
    url: item.url,
    date,
  };
}
