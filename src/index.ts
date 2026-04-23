import type { Env, TelegramUpdate } from "./types";
import { runDailyPipeline } from "./pipeline";
import { handleBotCommand, registerWebhook } from "./telegram";
import { handleIncomingEmail } from "./fetchers/newsletter";

/** 관리자 엔드포인트(/setup, /run) 인증 */
function checkAdminAuth(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization");
  return !!auth && auth === `Bearer ${env.TELEGRAM_WEBHOOK_SECRET}`;
}

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

export default {
  /**
   * HTTP 핸들러
   * - POST /webhook  : Telegram 봇 업데이트 (Telegram이 secret_token 전송)
   * - GET  /setup    : Webhook URL 등록 (Bearer 인증 필요)
   * - POST /run      : 수동 파이프라인 실행 (Bearer 인증 필요, 테스트용)
   * - GET  /         : 상태 확인
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Telegram Webhook — X-Telegram-Bot-Api-Secret-Token 헤더 검증
    if (url.pathname === "/webhook" && request.method === "POST") {
      const providedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (providedSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return unauthorized();
      }
      const update = (await request.json()) as TelegramUpdate;
      ctx.waitUntil(handleBotCommand(update, env));
      return new Response("ok");
    }

    // 관리자: Webhook URL 등록 (배포 후 1회)
    if (url.pathname === "/setup" && request.method === "GET") {
      if (!checkAdminAuth(request, env)) return unauthorized();
      const workerUrl = `${url.protocol}//${url.host}`;
      await registerWebhook(workerUrl, env);
      return new Response("Webhook registered!");
    }

    // 관리자: 수동 파이프라인 실행 (테스트용)
    if (url.pathname === "/run" && request.method === "POST") {
      if (!checkAdminAuth(request, env)) return unauthorized();
      ctx.waitUntil(runDailyPipeline(env));
      return new Response("Pipeline started");
    }

    return new Response("Daily Digest Bot is running ✅");
  },

  /** Cron 핸들러 — 매일 09:00 UTC = 18:00 KST */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDailyPipeline(env));
  },

  /** Email 핸들러 — Cloudflare Email Routing 수신 (도메인 설정 후 활성화) */
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleIncomingEmail(message, env));
  },
};
