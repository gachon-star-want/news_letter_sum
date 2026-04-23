# 📰 Daily Digest Bot

매일 아침 구독 중인 뉴스레터(RSS)와 유튜브 채널의 새 콘텐츠를 자동으로 수집하고, Claude AI로 한 줄 요약해 텔레그램으로 발송하는 개인용 봇입니다.

## 주요 기능

- **뉴스레터 수집** — RSS 피드 또는 이메일(Cloudflare Email Routing, 도메인 필요)
- **유튜브 수집** — 채널 최신 영상 자막/설명 기반 요약
- **AI 요약** — Claude Haiku + Opus Advisor + Prompt Caching으로 빠르고 정확하게, 비용 최소화
- **텔레그램 발송** — 매일 오전 8시 KST 자동 발송
- **봇 명령어** — 텔레그램에서 소스 추가/삭제/검색 가능
- **중복 제거** — KV TTL 기반으로 같은 콘텐츠 재발송 방지
- **아카이브 검색** — D1 FTS5 기반 과거 요약 전문 검색

## 기술 스택

| 항목 | 기술 |
|---|---|
| 런타임 | Cloudflare Workers |
| 언어 | TypeScript |
| AI | Anthropic Claude (Haiku + Opus Advisor + Prompt Caching) |
| DB | Cloudflare D1 (SQLite + FTS5) |
| 캐시 | Cloudflare KV |
| 알림 | Telegram Bot API |

## 시작하기

### 준비물

- [Cloudflare 계정](https://dash.cloudflare.com)
- [Telegram 봇 토큰](https://t.me/BotFather) — BotFather에서 발급
- 본인 텔레그램 Chat ID — `@userinfobot` 에서 확인
- [Anthropic API 키](https://console.anthropic.com)
- [YouTube Data API v3 키](https://console.cloud.google.com) — Google Cloud Console에서 발급
- Node.js 18 이상

### 설치 및 배포

```bash
# 1. 패키지 설치
npm install

# 2. Cloudflare 리소스 생성
npx wrangler kv namespace create DEDUP_KV
npx wrangler d1 create daily-digest
```

생성된 ID를 `wrangler.toml`에 입력:
```toml
[[kv_namespaces]]
binding = "DEDUP_KV"
id = "여기에_KV_ID"

[[d1_databases]]
binding = "ARCHIVE_DB"
database_name = "daily-digest"
database_id = "여기에_D1_ID"
```

```bash
# 3. 시크릿 등록
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put YOUTUBE_API_KEY
openssl rand -hex 32   # 아래 명령어에 붙여넣기
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET

# 4. DB 초기화
npm run db:init:remote

# 5. 배포
npm run deploy

# 6. 텔레그램 웹훅 등록 (1회)
curl "https://<worker-url>/setup" -H "Authorization: Bearer <TELEGRAM_WEBHOOK_SECRET>"
```

## 텔레그램 명령어

| 명령어 | 설명 |
|---|---|
| URL 전송 | 뉴스레터 등록 (RSS 자동 감지) |
| `/추가 rss <URL> <이름>` | RSS 피드 직접 등록 |
| `/추가 뉴스레터 <이메일> <이름>` | 이메일 방식 등록 (도메인 필요) |
| `/추가 유튜브 <채널URL> [이름]` | 유튜브 채널 등록 |
| `/목록` | 등록된 소스 확인 |
| `/삭제 <이름>` | 소스 삭제 |
| `/검색 <키워드>` | 과거 요약 검색 |

### 예시

```
https://uppity.co.kr          ← 봇에게 URL만 보내면 RSS 자동 감지
/추가 유튜브 https://youtube.com/@channelname
/검색 금리
```

## 비용 (월 기준)

| 항목 | 예상 비용 |
|---|---|
| Cloudflare Workers | 무료 (10만 req/일 이내) |
| Cloudflare D1 | 무료 (5GB 이내) |
| Cloudflare KV | 무료 (10만 read/일 이내) |
| Claude API (Haiku + Prompt Caching) | 약 $0.01 미만 (캐싱으로 입력 토큰 90% 절감) |
| YouTube Data API | 무료 (10,000 units/일 이내) |

## 라이선스

MIT
