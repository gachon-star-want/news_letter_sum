// ============================================================
// 공통 타입 정의
// ============================================================

export interface Env {
  // KV — 중복 URL 체크 (TTL 30일)
  DEDUP_KV: KVNamespace;
  // D1 — 요약 아카이브 + 검색
  ARCHIVE_DB: D1Database;
  // 환경 변수 (wrangler.toml [vars])
  LLM_PROVIDER: string;
  MAX_ITEMS_PER_SOURCE: string;
  // 시크릿 (wrangler secret put)
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  TELEGRAM_WEBHOOK_SECRET: string; // 웹훅 인증 + /run /setup 관리자 인증 겸용
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY?: string;
  YOUTUBE_API_KEY: string;
}

/** 수집된 원본 콘텐츠 1건 */
export interface ContentItem {
  sourceType: "newsletter" | "youtube";
  sourceName: string;
  title: string;
  url: string;
  /** 요약에 사용할 본문 (설명문 or 자막) */
  body: string;
  publishedAt: Date;
  language: "ko" | "en";
}

/** 요약이 완료된 항목 1건 */
export interface SummaryItem {
  sourceType: "newsletter" | "youtube";
  sourceName: string;
  title: string;
  summaryKo: string;
  url: string;
  date: string; // "YYYY-MM-DD"
}

/** Telegram 업데이트 (봇 명령어 수신) */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number };
    chat: { id: number };
    text?: string;
    date: number;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
}

/** YouTube Data API v3 검색 결과 */
export interface YouTubeSearchResponse {
  items: Array<{
    id: { videoId: string };
    snippet: {
      title: string;
      description: string;
      publishedAt: string;
      channelTitle: string;
    };
  }>;
}

/** YouTube transcript 파싱 결과 */
export interface TranscriptSegment {
  start: number;
  dur: number;
  text: string;
}
