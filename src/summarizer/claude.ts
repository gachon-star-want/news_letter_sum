import type { LLMProvider } from "./index";
import { fetchWithTimeout } from "../util";

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

export class ClaudeProvider implements LLMProvider {
  constructor(private apiKey: string) {}

  async summarize(body: string, language: "ko" | "en"): Promise<string> {
    const content = body.slice(0, 3000);
    const prompt =
      language === "ko"
        ? `다음 내용을 한국어로 30~50자 이내 한 줄로 핵심만 요약해줘. 요약문만 출력하고 다른 말은 하지 마:\n\n${content}`
        : `Translate the key point to Korean and summarize in one concise sentence (30-50 Korean characters). Output the Korean summary only:\n\n${content}`;

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
          tools: [{
            type: "advisor_20260301",
            name: "advisor",
            advisor_model: "claude-opus-4-7",
            max_uses: 1,
          }],
          messages: [{ role: "user", content: prompt }],
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
