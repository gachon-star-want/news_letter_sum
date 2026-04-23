import type { Env, TelegramUpdate } from "./types";
import {
  addNewsletterSource,
  addYoutubeSource,
  removeSource,
  listAllSources,
  resolveYoutubeChannel,
} from "./sources";
import { escapeHtml, fetchWithTimeout } from "./util";

const BASE_URL = "https://api.telegram.org/bot";

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
      allowed_updates: ["message"],
    }),
  }, 10000);
  if (!res.ok) throw new Error(`Webhook 등록 실패: ${await res.text()}`);
}

// ──────────────────────────────────────────────
// 메인 라우터
// ──────────────────────────────────────────────

export async function handleBotCommand(update: TelegramUpdate, env: Env): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  const chatId = String(msg.chat.id);
  if (chatId !== env.TELEGRAM_CHAT_ID) return;

  const text = msg.text.trim();

  try {
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
// 명령어 핸들러
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
    "사용법:\n<code>/추가 뉴스레터 발신이메일 이름</code>\n<code>/추가 유튜브 채널URL [이름]</code>",
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
    await sendMessage(chatId, "아직 등록된 소스가 없어요.\n\n텔레그램에서 명령을 사용해 추가하세요.", env);
    return;
  }

  const newsletters = sources.filter((s) => s.type === "newsletter");
  const youtube = sources.filter((s) => s.type === "youtube");
  const lines: string[] = ["📋 <b>구독 중인 소스</b>\n"];

  if (newsletters.length) {
    lines.push("📧 <b>뉴스레터</b>");
    for (const s of newsletters) {
      lines.push(`  • ${escapeHtml(s.name)}${s.active ? "" : " (비활성)"}\n    <code>${escapeHtml(s.identifier)}</code>`);
    }
  }

  if (youtube.length) {
    if (newsletters.length) lines.push("");
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
      "매일 오후 6시(18:00 KST)에 구독 채널의 새 소식을 요약해서 보내드려요.\n\n" +
      "<b>뉴스레터 추가</b>\n" +
      "<code>/추가 뉴스레터 발신이메일@example.com 이름</code>\n\n" +
      "<b>유튜브 추가</b>\n" +
      "<code>/추가 유튜브 채널URL [이름]</code>\n\n" +
      "<b>소스 관리</b>\n" +
      "/목록 · /삭제 <code>이름</code>\n\n" +
      "<b>검색</b>\n" +
      "/검색 <code>키워드</code>",
    env
  );
}
