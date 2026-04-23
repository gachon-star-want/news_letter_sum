import type { Env, TelegramUpdate } from "./types";
import {
  addNewsletterSource,
  addRssSource,
  addYoutubeSource,
  removeSource,
  listAllSources,
  resolveYoutubeChannel,
} from "./sources";
import { escapeHtml, fetchWithTimeout } from "./util";

const BASE_URL = "https://api.telegram.org/bot";

// ──────────────────────────────────────────────
// 대화 상태 (KV에 저장, TTL 5분)
// ──────────────────────────────────────────────

interface AddState {
  step: "choose_method" | "enter_name";
  siteUrl: string;
  rssUrl: string | null;
  method: "email" | "rss" | null;
}

const STATE_TTL = 300; // 5분

async function getState(chatId: string, env: Env): Promise<AddState | null> {
  const raw = await env.DEDUP_KV.get(`add_state:${chatId}`);
  return raw ? (JSON.parse(raw) as AddState) : null;
}

async function setState(chatId: string, state: AddState, env: Env): Promise<void> {
  await env.DEDUP_KV.put(`add_state:${chatId}`, JSON.stringify(state), { expirationTtl: STATE_TTL });
}

async function clearState(chatId: string, env: Env): Promise<void> {
  await env.DEDUP_KV.delete(`add_state:${chatId}`);
}

// ──────────────────────────────────────────────
// Telegram API 헬퍼
// ──────────────────────────────────────────────

export async function sendMessage(chatId: string, text: string, env: Env): Promise<void> {
  const url = `${BASE_URL}${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }, 10000);
  if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
}

async function sendMessageWithButtons(
  chatId: string,
  text: string,
  buttons: Array<Array<{ text: string; callback_data: string }>>,
  env: Env
): Promise<void> {
  const url = `${BASE_URL}${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buttons },
    }),
  }, 10000);
  if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
}

async function answerCallbackQuery(callbackQueryId: string, env: Env): Promise<void> {
  const url = `${BASE_URL}${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
  await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  }, 10000).catch(() => {});
}

export async function sendToMe(text: string, env: Env): Promise<void> {
  await sendMessage(env.TELEGRAM_CHAT_ID, text, env);
}

export async function sendError(error: unknown, context: string, env: Env): Promise<void> {
  const msg = error instanceof Error ? error.message : String(error);
  await sendToMe(`⚠️ <b>오류 발생</b>\n<code>${escapeHtml(context)}</code>\n${escapeHtml(msg)}`, env).catch(() => {});
}

export async function registerWebhook(workerUrl: string, env: Env): Promise<void> {
  const url = `${BASE_URL}${env.TELEGRAM_BOT_TOKEN}/setWebhook`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: `${workerUrl}/webhook`,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query"],
    }),
  }, 10000);
  if (!res.ok) throw new Error(`Webhook 등록 실패: ${await res.text()}`);
}

// ──────────────────────────────────────────────
// RSS 자동 감지
// ──────────────────────────────────────────────

async function detectRssFeed(siteUrl: string): Promise<string | null> {
  const base = siteUrl.replace(/\/+$/, "").split("?")[0];

  // 1. 메인 페이지에서 RSS link 태그 탐색
  try {
    const res = await fetchWithTimeout(base, {}, 10000);
    if (res.ok) {
      const html = await res.text();
      const found = extractRssLinkFromHtml(html, base);
      if (found) return found;
    }
  } catch {}

  // 2. 일반적인 RSS 경로 시도
  for (const path of ["/feed/", "/feed", "/rss.xml", "/rss", "/atom.xml"]) {
    try {
      const res = await fetchWithTimeout(base + path, {}, 5000);
      const ct = res.headers.get("content-type") ?? "";
      if (res.ok && (ct.includes("xml") || ct.includes("rss"))) return base + path;
    } catch {}
  }

  return null;
}

function extractRssLinkFromHtml(html: string, base: string): string | null {
  const patterns = [
    /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]*type=["']application\/(?:rss|atom)\+xml["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m) continue;
    const href = m[1];
    if (href.startsWith("http")) return href;
    try {
      return new URL(href, base).href;
    } catch {
      return null;
    }
  }
  return null;
}

// ──────────────────────────────────────────────
// 대화형 등록 플로우
// ──────────────────────────────────────────────

/** URL 메시지 수신 → RSS 감지 후 방식 선택 요청 */
async function handleUrlInput(chatId: string, rawUrl: string, env: Env): Promise<void> {
  await sendMessage(chatId, "⏳ RSS 피드를 확인하고 있어요...", env);

  const rssUrl = await detectRssFeed(rawUrl);

  if (rssUrl) {
    await setState(chatId, { step: "choose_method", siteUrl: rawUrl, rssUrl, method: null }, env);
    await sendMessageWithButtons(
      chatId,
      `✅ RSS 피드를 찾았어요!\n<code>${escapeHtml(rssUrl)}</code>\n\n어떤 방식으로 받으시겠어요?`,
      [[
        { text: "📰 RSS로 받기", callback_data: "method:rss" },
        { text: "📧 이메일로 받기", callback_data: "method:email" },
      ]],
      env
    );
  } else {
    await setState(chatId, { step: "enter_name", siteUrl: rawUrl, rssUrl: null, method: "email" }, env);
    await sendMessage(
      chatId,
      "해당 뉴스레터는 RSS를 지원하지 않아요.\n📧 이메일로만 받을 수 있어요.\n\n뉴스레터 이름을 입력해주세요.\n예: <code>뉴닉</code>",
      env
    );
  }
}

/** 버튼 탭 처리 (이메일 / RSS 선택) */
async function handleCallbackQuery(
  cq: NonNullable<TelegramUpdate["callback_query"]>,
  env: Env
): Promise<void> {
  await answerCallbackQuery(cq.id, env);

  const chatId = String(cq.from.id);
  if (chatId !== env.TELEGRAM_CHAT_ID) return;

  const data = cq.data ?? "";
  if (!data.startsWith("method:")) return;

  const method = data.replace("method:", "") as "email" | "rss";
  const state = await getState(chatId, env);
  if (!state) {
    await sendMessage(chatId, "시간이 초과됐어요. URL을 다시 보내주세요.", env);
    return;
  }

  await setState(chatId, { ...state, step: "enter_name", method }, env);

  const label = method === "rss" ? "RSS" : "이메일";
  await sendMessage(
    chatId,
    `${method === "rss" ? "📰" : "📧"} <b>${label}</b> 방식으로 등록할게요.\n\n뉴스레터 이름을 입력해주세요.\n예: <code>어피티</code>`,
    env
  );
}

/** 이름 입력 처리 → 최종 등록 */
async function handleNameInput(chatId: string, name: string, state: AddState, env: Env): Promise<void> {
  await clearState(chatId, env);

  const language = /[가-힣]/.test(name) ? "ko" : "en";

  if (state.method === "rss" && state.rssUrl) {
    await addRssSource(name, state.rssUrl, language, env);
    await sendMessage(
      chatId,
      `✅ 등록 완료!\n이름: <b>${escapeHtml(name)}</b>\nRSS: <code>${escapeHtml(state.rssUrl)}</code>`,
      env
    );
  } else {
    await sendMessage(
      chatId,
      `📧 이메일 방식은 도메인 설정이 필요해요.\n\n도메인 준비 후 텔레그램에서:\n<code>/추가 뉴스레터 발신이메일 ${escapeHtml(name)}</code>\n으로 등록해주세요.`,
      env
    );
  }
}

// ──────────────────────────────────────────────
// 메인 라우터
// ──────────────────────────────────────────────

export async function handleBotCommand(update: TelegramUpdate, env: Env): Promise<void> {
  // 버튼 탭
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env);
    return;
  }

  const msg = update.message;
  if (!msg?.text) return;

  const chatId = String(msg.chat.id);
  if (chatId !== env.TELEGRAM_CHAT_ID) return;

  const text = msg.text.trim();

  try {
    // URL 입력 → 뉴스레터 등록 플로우
    if (/^https?:\/\/\S+$/.test(text)) {
      await handleUrlInput(chatId, text, env);
      return;
    }

    // 이름 입력 대기 상태 확인
    if (!text.startsWith("/")) {
      const state = await getState(chatId, env);
      if (state?.step === "enter_name") {
        await handleNameInput(chatId, text, state, env);
        return;
      }
    }

    // 기존 명령어
    if (text.startsWith("/추가") || text.startsWith("/add")) {
      await handleAdd(chatId, text, env);
    } else if (text.startsWith("/삭제") || text.startsWith("/remove")) {
      await handleRemove(chatId, text, env);
    } else if (text === "/목록" || text === "/list") {
      await handleList(chatId, env);
    } else if (text.startsWith("/검색") || text.startsWith("/search")) {
      const keyword = text.replace(/^\/(검색|search)\s*/, "").trim();
      if (!keyword) {
        await sendMessage(chatId, "검색어를 입력해주세요. 예: <code>/검색 AI</code>", env);
        return;
      }
      await handleSearch(chatId, keyword, env);
    } else if (text === "/start" || text === "/도움말" || text === "/help") {
      await handleHelp(chatId, env);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await sendMessage(chatId, `❌ ${escapeHtml(errMsg)}`, env);
  }
}

// ──────────────────────────────────────────────
// 기존 명령어 핸들러 (텍스트 명령 방식 유지)
// ──────────────────────────────────────────────

async function handleAdd(chatId: string, text: string, env: Env): Promise<void> {
  const parts = text.replace(/^\/(추가|add)\s*/, "").trim().split(/\s+/);
  const subtype = parts[0]?.toLowerCase();

  if (subtype === "뉴스레터" || subtype === "newsletter") {
    const email = parts[1];
    const name = parts.slice(2).join(" ");
    if (!email || !name) {
      await sendMessage(chatId, "사용법: <code>/추가 뉴스레터 발신이메일 이름</code>", env);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await sendMessage(chatId, "올바른 이메일 주소를 입력해주세요.", env);
      return;
    }
    const language = /[가-힣]/.test(name) ? "ko" : "en";
    await addNewsletterSource(name, email, language, env);
    await sendMessage(chatId, `✅ 뉴스레터 추가 완료!\n이름: <b>${escapeHtml(name)}</b>\n이메일: <code>${escapeHtml(email)}</code>`, env);
    return;
  }

  if (subtype === "rss") {
    const rssUrl = parts[1];
    const name = parts.slice(2).join(" ");
    if (!rssUrl || !name) {
      await sendMessage(chatId, "사용법: <code>/추가 rss RSS주소 이름</code>", env);
      return;
    }
    if (!/^https?:\/\/.+/.test(rssUrl)) {
      await sendMessage(chatId, "올바른 URL을 입력해주세요. (https://... 형식)", env);
      return;
    }
    const language = /[가-힣]/.test(name) ? "ko" : "en";
    await addRssSource(name, rssUrl, language, env);
    await sendMessage(chatId, `✅ RSS 추가 완료!\n이름: <b>${escapeHtml(name)}</b>\nRSS: <code>${escapeHtml(rssUrl)}</code>`, env);
    return;
  }

  if (subtype === "유튜브" || subtype === "youtube") {
    const input = parts[1];
    const customName = parts.slice(2).join(" ") || null;
    if (!input) {
      await sendMessage(chatId, "사용법: <code>/추가 유튜브 채널URL [이름]</code>", env);
      return;
    }
    await sendMessage(chatId, "⏳ 채널 정보를 조회하고 있어요...", env);
    const { channelId, name: autoName, language } = await resolveYoutubeChannel(input, env.YOUTUBE_API_KEY);
    const name = customName || autoName;
    await addYoutubeSource(name, channelId, language, env);
    await sendMessage(
      chatId,
      `✅ 유튜브 채널 추가 완료!\n채널: <b>${escapeHtml(name)}</b>\nID: <code>${escapeHtml(channelId)}</code>\n언어: ${language === "ko" ? "🇰🇷 한국어" : "🇺🇸 영어"}`,
      env
    );
    return;
  }

  await sendMessage(
    chatId,
    "사용법:\n<code>/추가 뉴스레터 이메일 이름</code>\n<code>/추가 rss RSS주소 이름</code>\n<code>/추가 유튜브 채널URL [이름]</code>",
    env
  );
}

async function handleRemove(chatId: string, text: string, env: Env): Promise<void> {
  const name = text.replace(/^\/(삭제|remove)\s*/, "").trim();
  if (!name) {
    await sendMessage(chatId, "사용법: <code>/삭제 이름</code>\n등록된 소스 목록은 <code>/목록</code> 으로 확인하세요.", env);
    return;
  }
  const deleted = await removeSource(name, env);
  const safeName = escapeHtml(name);
  if (deleted) {
    await sendMessage(chatId, `🗑 <b>${safeName}</b> 삭제 완료.`, env);
  } else {
    await sendMessage(chatId, `❌ <b>${safeName}</b>을(를) 찾을 수 없어요.\n<code>/목록</code> 으로 정확한 이름을 확인해주세요.`, env);
  }
}

async function handleList(chatId: string, env: Env): Promise<void> {
  const sources = await listAllSources(env);
  if (!sources.length) {
    await sendMessage(chatId, "아직 등록된 소스가 없어요.\n\nURL을 보내주시면 바로 등록할 수 있어요!", env);
    return;
  }

  const newsletters = sources.filter((s) => s.type === "newsletter");
  const rssFeeds = sources.filter((s) => s.type === "rss");
  const youtube = sources.filter((s) => s.type === "youtube");
  const lines: string[] = ["📋 <b>구독 중인 소스</b>\n"];

  if (newsletters.length) {
    lines.push("📧 <b>뉴스레터 (이메일)</b>");
    for (const s of newsletters) {
      lines.push(`  • ${escapeHtml(s.name)}${s.active ? "" : " (비활성)"}\n    <code>${escapeHtml(s.identifier)}</code>`);
    }
  }

  if (rssFeeds.length) {
    if (newsletters.length) lines.push("");
    lines.push("📰 <b>뉴스레터 (RSS)</b>");
    for (const s of rssFeeds) {
      lines.push(`  • ${escapeHtml(s.name)}${s.active ? "" : " (비활성)"}\n    <code>${escapeHtml(s.identifier)}</code>`);
    }
  }

  if (youtube.length) {
    if (newsletters.length || rssFeeds.length) lines.push("");
    lines.push("📺 <b>유튜브</b>");
    for (const s of youtube) {
      const lang = s.language === "ko" ? "🇰🇷" : "🇺🇸";
      lines.push(`  • ${escapeHtml(s.name)} ${lang}${s.active ? "" : " (비활성)"}\n    <code>${escapeHtml(s.identifier)}</code>`);
    }
  }

  lines.push(`\n총 ${sources.length}개 · /삭제 이름 으로 제거`);
  await sendMessage(chatId, lines.join("\n"), env);
}

async function handleSearch(chatId: string, keyword: string, env: Env): Promise<void> {
  const { searchSummaries } = await import("./archive");
  const results = await searchSummaries(keyword, env, 10);
  const safeKeyword = escapeHtml(keyword);
  if (!results.length) {
    await sendMessage(chatId, `<b>"${safeKeyword}"</b> 관련 소식을 찾을 수 없어요.`, env);
    return;
  }
  const lines = results
    .map((r) => `• [${r.date}] <a href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a>\n  ${escapeHtml(r.summary_ko)}`)
    .join("\n\n");
  await sendMessage(chatId, `🔍 <b>"${safeKeyword}"</b> 검색 결과 (${results.length}건)\n\n${lines}`, env);
}

async function handleHelp(chatId: string, env: Env): Promise<void> {
  await sendMessage(
    chatId,
    "📰 <b>Daily Digest Bot</b>\n" +
      "매일 아침 8시에 구독 채널의 새 소식을 요약해서 보내드려요.\n\n" +
      "<b>소스 추가</b>\n" +
      "사이트 주소를 그냥 보내주세요. RSS 여부를 자동으로 확인해드려요.\n" +
      "예: <code>https://uppity.co.kr</code>\n\n" +
      "<b>유튜브 추가</b>\n" +
      "<code>/추가 유튜브 채널URL [이름]</code>\n\n" +
      "<b>소스 관리</b>\n" +
      "/목록 · /삭제 <code>이름</code>\n\n" +
      "<b>검색</b>\n" +
      "/검색 <code>키워드</code>",
    env
  );
}
