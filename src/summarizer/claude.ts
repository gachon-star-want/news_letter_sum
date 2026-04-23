import type { LLMProvider } from "./index";
import { fetchWithTimeout } from "../util";

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

// 지시문과 tool 정의는 모든 호출에서 동일 → 캐싱으로 입력 토큰 90% 절감
const SYSTEM_KO = "다음 내용을 한국어로 30~50자 이내 한 줄로 핵심만 요약해줘. 요약문만 출력하고 다른 말은 하지 마.";
const SYSTEM_EN = "Translate the key point to Korean and summarize in one concise sentence (30-50 Korean characters). Output the Korean summary only.";

export class ClaudeProvider implements LLMProvider {
  constructor(private apiKey: string) {}

  async summarize(body: string, language: "ko" | "en"): Promise<string> {
    const content = body.slice(0, 3000);

    const res = await fetchWithTimeout(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 120,
          // 지시문 캐싱: 동일 파이프라인 내 2번째 호출부터 read 비용(write의 10%)만 청구
          system: [{
            type: "text",
            text: language === "ko" ? SYSTEM_KO : SYSTEM_EN,
            cache_control: { type: "ephemeral" },
          }],
          // tool 정의도 캐싱: system + tools 전체를 하나의 캐시 블록으로 처리
          tools: [{
            type: "advisor_20260301",
            name: "advisor",
            advisor_model: "claude-opus-4-7",
            max_uses: 1,
            cache_control: { type: "ephemeral" },
          }],
          messages: [{ role: "user", content }],
        }),
      },
      25000
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API error: ${res.status} ${err}`);
    }

    const data = (await res.json()) as AnthropicResponse;
    const text = data.content.filter((b) => b.type === "text").pop()?.text;
    if (!text) throw new Error("Claude 응답에 텍스트가 없습니다.");
    return text.trim();
  }
}
