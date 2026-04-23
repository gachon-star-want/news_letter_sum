# 📰 Daily Digest Bot

매일 오후 6시(18:00 KST)에 전용 이메일로 수신되는 뉴스레터와 구독 유튜브 채널의 새 콘텐츠를 자동으로 수집하고, Claude AI로 한 줄 요약해 텔레그램으로 발송하는 개인용 봇입니다.

## 주요 기능

- **뉴스레터 수집** — 전용 이메일 계정으로 수신 (Cloudflare Email Routing)
  - Message-ID 기반 중복 제거로 동일 이메일은 1개만 처리
  - 다른 발신처의 이메일은 모두 수집
- **유튜브 수집** — 채널 최신 영상 자막/설명 기반 요약 (지난 24시간)
- **AI 요약** — Claude Haiku + Opus Advisor + Prompt Caching
  - Haiku: 빠르고 저렴한 주요 요약 (자신감 점수 함께 제공)
  - Opus Advisor: 자신감 < 0.75인 경우만 자동 검수/개선
  - 캐싱: 시스템 프롬프트 캐싱으로 입력 토큰 90% 절감
- **텔레그램 발송** — 매일 오후 6시(18:00 KST) 자동 발송
- **봇 명령어** — 텔레그램에서 소스 추가/삭제/검색 가능
- **중복 제거** — KV TTL 기반으로 30일 내 같은 콘텐츠 재발송 방지
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
id = "YOUR_KV_NAMESPACE_ID"
preview_id = "YOUR_KV_PREVIEW_ID"

[[d1_databases]]
binding = "ARCHIVE_DB"
database_name = "daily-digest"
database_id = "YOUR_D1_DATABASE_ID"
```

### 도메인 및 이메일 설정

Cloudflare Email Routing을 사용하여 뉴스레터 전용 이메일을 설정해야 합니다:

```bash
# 예: newsletter.example.com 도메인에서 수신
# 1. Cloudflare에서 도메인 추가
# 2. Email Routing 활성화
# 3. 라우팅 규칙 추가:
#    - Catch-all: digest@newsletter.example.com → 이 Workers로 전달
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
| `/추가 뉴스레터 <이메일> <이름>` | 뉴스레터 발신 이메일 등록 |
| `/추가 유튜브 <채널URL> [이름]` | 유튜브 채널 등록 |
| `/목록` | 등록된 소스 확인 |
| `/삭제 <이름>` | 소스 삭제 |
| `/검색 <키워드>` | 과거 요약 검색 |

### 예시

```
/추가 뉴스레터 newsletter@bensbites.co Ben's Bites
/추가 유튜브 https://youtube.com/@channelname
/목록
/검색 AI
/삭제 Ben's Bites
```

### 뉴스레터 등록 방법

1. **이메일 전달 설정**: 구독 중인 뉴스레터를 `digest@newsletter.example.com`으로 전달하도록 설정
2. **봇 명령 실행**: 
   ```
   /추가 뉴스레터 original-newsletter@source.com 뉴스레터이름
   ```
3. 이제 해당 뉴스레터가 `digest@` 계정으로 오는 모든 이메일이 자동 요약됩니다

## 비용 (월 기준)

| 항목 | 예상 비용 |
|---|---|
| Cloudflare Workers | 무료 (10만 req/일 이내) |
| Cloudflare D1 | 무료 (5GB 이내) |
| Cloudflare KV | 무료 (10만 read/일 이내) |
| Cloudflare Email Routing | 무료 (도메인에 연결된 경우) |
| Claude API (Haiku + Opus Advisor) | **$2.10 ~ $3.50/월** |
| YouTube Data API | 무료 (10,000 units/일 이내) |

### 최적화된 비용 구조

- **Haiku 주 실행** (기본): 빠르고 저렴한 요약 제공
- **Opus 자동 검수** (선택적): 자신감 < 0.75인 경우만 호출 (~10~20%)
- **Prompt Caching**: 시스템 프롬프트 캐싱으로 입력 토큰 90% 절감
- **결과**: 월 $2.10~$3.50으로 Opus 수준의 요약 품질 달성

> 하루 평균 15건의 뉴스레터/영상 처리 시 기준

## 라이선스

MIT
