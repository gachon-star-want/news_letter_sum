import type { LLMProvider } from "./index";
import { fetchWithTimeout } from "../util";

interface OpenAIResponse {
  choices: Array<{ message: { content: string } }>;
}

export class OpenAIProvider implements LLMProvider {
  constructor(private apiKey: string) {}

  async summarize(body: string, language: "ko" | "en"): Promise<string> {
    const content = body.slice(0, 3000);
    const systemPrompt =
      "You are a concise summarizer. Output Korean summaries only, 30-50 characters.";
    const userPrompt =
      language === "ko"
        ? `다음 내용을 한국어로 30~50자 이내 한 줄 요약:\n\n${content}`
        : `Translate to Korean and summarize in one sentence (30-50 chars):\n\n${content}`;

    const res = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 120,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      },
      25000
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error: ${res.status} ${err}`);
    }

    const data = (await res.json()) as OpenAIResponse;
    return data.choices[0].message.content.trim();
  }
}
