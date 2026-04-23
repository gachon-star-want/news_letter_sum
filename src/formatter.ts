import type { SummaryItem } from "./types";
import { escapeHtml } from "./util";

const EMOJI: Record<string, string> = {
  newsletter: "📧",
  youtube: "📺",
};

/** 전체 일일 요약 메시지 조립 */
export function formatDailyDigest(items: SummaryItem[], date: string): string {
  if (items.length === 0) {
    return `📰 <b>오늘의 소식 (${date})</b>\n\n오늘은 새 소식이 없어요.`;
  }

  const order: Array<"newsletter" | "youtube"> = ["newsletter", "youtube"];
  const sections: string[] = [];

  for (const type of order) {
    const group = items.filter((i) => i.sourceType === type);
    if (!group.length) continue;

    const emoji = EMOJI[type];
    const label = type === "newsletter" ? "뉴스레터" : "유튜브";
    const lines = group.map((item) => formatItem(item));
    sections.push(`${emoji} <b>${label}</b>\n${lines.join("\n")}`);
  }

  const header = `📰 <b>오늘의 소식 (${date} · 08:00 KST)</b>`;
  const footer = `\n────────────────\n총 ${items.length}건`;

  return [header, "", ...sections, footer].join("\n");
}

function formatItem(item: SummaryItem): string {
  const title = escapeHtml(item.title);
  const summary = escapeHtml(item.summaryKo);
  const url = escapeHtml(item.url);
  return `• <a href="${url}">${title}</a>\n  ${summary}`;
}
