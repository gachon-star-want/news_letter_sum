import type { Env } from "../types";
import { ClaudeProvider } from "./claude";
import { OpenAIProvider } from "./openai";

/** LLM 프로바이더 추상화 인터페이스 */
export interface LLMProvider {
  summarize(body: string, language: "ko" | "en"): Promise<string>;
}

/** 환경 변수 기반으로 프로바이더 생성 */
export function createProvider(env: Env): LLMProvider {
  const provider = env.LLM_PROVIDER ?? "claude";
  if (provider === "openai" && env.OPENAI_API_KEY) {
    return new OpenAIProvider(env.OPENAI_API_KEY);
  }
  return new ClaudeProvider(env.ANTHROPIC_API_KEY);
}

/** 요약 실행 (Claude 실패 시 OpenAI로 fallback) */
export async function summarizeWithFallback(
  body: string,
  language: "ko" | "en",
  env: Env
): Promise<string> {
  const primary = createProvider(env);
  try {
    return await primary.summarize(body, language);
  } catch (err) {
    // Claude가 실패하고 OpenAI 키가 있으면 fallback
    if (env.OPENAI_API_KEY && !(primary instanceof OpenAIProvider)) {
      const fallback = new OpenAIProvider(env.OPENAI_API_KEY);
      return await fallback.summarize(body, language);
    }
    throw err;
  }
}
