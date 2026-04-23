-- ============================================================
-- Daily Digest Bot — D1 Database Schema
-- 초기화: npm run db:init (로컬) | npm run db:init:remote (배포)
-- ============================================================

-- 발송된 요약 아카이브 (검색 + 히스토리)
CREATE TABLE IF NOT EXISTS summaries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT    NOT NULL,              -- "2026-04-23"
  source_type TEXT    NOT NULL,              -- "newsletter" | "youtube"
  source_name TEXT    NOT NULL,              -- "조코딩"
  title       TEXT    NOT NULL,
  summary_ko  TEXT    NOT NULL,              -- 한국어 요약 1줄
  url         TEXT    NOT NULL UNIQUE,       -- 원문 링크
  created_at  INTEGER NOT NULL               -- unix timestamp
);

CREATE INDEX IF NOT EXISTS idx_summaries_date   ON summaries(date);
CREATE INDEX IF NOT EXISTS idx_summaries_source ON summaries(source_type, source_name);

-- 전문 검색 (FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(
  title,
  summary_ko,
  content    = "summaries",
  content_rowid = "id",
  tokenize   = "unicode61"
);

-- FTS 인덱스 자동 동기화
CREATE TRIGGER IF NOT EXISTS summaries_ai AFTER INSERT ON summaries BEGIN
  INSERT INTO summaries_fts(rowid, title, summary_ko)
  VALUES (new.id, new.title, new.summary_ko);
END;

CREATE TRIGGER IF NOT EXISTS summaries_ad AFTER DELETE ON summaries BEGIN
  INSERT INTO summaries_fts(summaries_fts, rowid, title, summary_ko)
  VALUES ('delete', old.id, old.title, old.summary_ko);
END;

-- 이메일로 받은 뉴스레터 임시 저장 (Email Worker → Cron 처리)
CREATE TABLE IF NOT EXISTS pending_emails (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT    NOT NULL,
  subject     TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  language    TEXT    NOT NULL DEFAULT 'ko',
  received_at INTEGER NOT NULL,
  processed   INTEGER NOT NULL DEFAULT 0     -- 0: 대기, 1: 처리완료
);

CREATE INDEX IF NOT EXISTS idx_pending_unprocessed ON pending_emails(processed, received_at);

-- 구독 소스 목록 (텔레그램 봇으로 추가/삭제)
CREATE TABLE IF NOT EXISTS sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT    NOT NULL,              -- "newsletter" | "rss" | "youtube"
  name        TEXT    NOT NULL UNIQUE,       -- 사용자가 붙인 이름
  identifier  TEXT    NOT NULL,              -- newsletter: 발신 이메일 / rss: 피드 URL / youtube: channelId
  language    TEXT    NOT NULL DEFAULT 'ko', -- "ko" | "en"
  active      INTEGER NOT NULL DEFAULT 1,    -- 1: 활성, 0: 비활성
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sources_type ON sources(type, active);
