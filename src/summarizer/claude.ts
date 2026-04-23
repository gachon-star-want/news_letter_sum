import type { LLMProvider } from "./index";
import { fetchWithTimeout, CONFIDENCE_THRESHOLD } from "../util";

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

const HAIKU_SYSTEM_KO = `다음 내용을 한국어로 30~50자 이내 한 줄로 핵심만 요약해줘.
반드시 아래 JSON 형식으로만 응답해:
{"summary":"요약문","confidence":0.0~1.0}
confidence는 0(불확실)~1(확실) 사이 숫자.`;

const HAIKU_SYSTEM_EN = `Summarize the key point in one concise Korean sentence (30-50 characters).
Respond only in this JSON format:
{"summary":"Korean summary","confidence":0.0~1.0}
confidence is your certainty from 0 (uncertain) to 1 (certain).`;

const OPUS_SYSTEM_KO = `아래 기사 내용과 초안 요약을 보고, 30~50자 이내 한 줄 한국어 요약을 최종 완성해줘. 요약문만 출력하고 다른 말은 하지 마.`;
const OPUS_SYSTEM_EN = `Review the article and the draft summary below. Output only the final Korean summary in 30-50 characters.`;

interface HaikuResult {
  summary: string;
  confidence: number;
}

export class ClaudeProvider implements LLMProvider {
  constructor(private apiKey: string) {}

  async summarize(body: string, language: "ko" | "en"): Promise<string> {
    const content = body.slice(0, 3000);
    const haikusResult = await this.callHaiku(content, language);

    if (haikusResult.confidence < CONFIDENCE_THRESHOLD) {
      return await this.callOpus(content, haikusResult.summary, language);
    }

    return haikusResult.summary;
  }

  private async callHaiku(content: string, language: "ko" | "en"): Promise<HaikuResult> {
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
          max_tokens: 150,
          system: [{
            type: "text",
            text: language === "ko" ? HAIKU_SYSTEM_KO : HAIKU_SYSTEM_EN,
            cache_control: { type: "ephemeral" },
          }],
          messages: [{ role: "user", content }],
        }),
      },
      25000
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude Haiku API error: ${res.status} ${err}`);
    }

    const data = (await res.json()) as AnthropicResponse;
    const text = data.content.filter((b) => b.type === "text").pop()?.text;
    if (!text) throw new Error("Haiku 응답에 텍스트가 없습니다.");

    try {
      const parsed = JSON.parse(text.trim());
      if (!parsed.summary) {
        console.warn("Haiku: missing 'summary' field in JSON response", { text });
        return { summary: "", confidence: 0.3 };
      }
      return {
        summary: parsed.summary,
        confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
      };
    } catch (err) {
      console.error("Haiku: JSON parse failed", { error: err, text });
      return { summary: "", confidence: 0.2 };
    }
  }

  private async callOpus(content: string, haikusSummary: string, language: "ko" | "en"): Promise<string> {
    const userMessage = `기사:\n${content}\n\n초안 요약:\n${haikusSummary}`;

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
          model: "claude-opus-4-7",
          max_tokens: 120,
          system: [{
            type: "text",
            text: language === "ko" ? OPUS_SYSTEM_KO : OPUS_SYSTEM_EN,
            cache_control: { type: "ephemeral" },
          }],
          messages: [{ role: "user", content: userMessage }],
        }),
      },
      25000
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude Opus API error: ${res.status} ${err}`);
    }

    const data = (await res.json()) as AnthropicResponse;
    const text = data.content.filter((b) => b.type === "text").pop()?.text;
    if (!text) throw new Error("Opus 응답에 텍스트가 없습니다.");
    return text.trim();
  }
}
