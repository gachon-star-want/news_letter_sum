import type { ContentItem, YouTubeSearchResponse } from "../types";
import { fetchWithTimeout } from "../util";

const YT_API = "https://www.googleapis.com/youtube/v3";

/** 채널의 최근 N시간 내 새 영상 수집 */
export async function fetchYoutubeVideos(
  channelId: string,
  channelName: string,
  language: "ko" | "en",
  apiKey: string,
  maxResults: number = 5
): Promise<ContentItem[]> {
  const publishedAfter = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24시간 전

  const params = new URLSearchParams({
    part: "snippet",
    channelId,
    type: "video",
    order: "date",
    maxResults: String(maxResults),
    publishedAfter,
    key: apiKey,
  });

  const res = await fetchWithTimeout(`${YT_API}/search?${params}`, {}, 15000);
  if (!res.ok) {
    throw new Error(`YouTube API error for ${channelName}: ${res.status}`);
  }

  const data = (await res.json()) as YouTubeSearchResponse;
  if (!data.items?.length) return [];

  const items = await Promise.all(
    data.items.map(async (item) => {
      const videoId = item.id.videoId;
      const url = `https://www.youtube.com/watch?v=${videoId}`;

      // 자막 시도, 실패 시 설명문 사용
      const transcript = await fetchTranscript(videoId).catch(() => null);
      const description = item.snippet.description.slice(0, 2000);
      const body = transcript ?? (description || item.snippet.title);

      return {
        sourceType: "youtube" as const,
        sourceName: channelName,
        title: item.snippet.title,
        url,
        body,
        publishedAt: new Date(item.snippet.publishedAt),
        language,
      };
    })
  );

  return items;
}

/** YouTube 자막 가져오기 (비공개 영상 또는 자막 없으면 null) */
async function fetchTranscript(videoId: string): Promise<string | null> {
  // 1단계: 영상 페이지에서 captionTracks URL 파싱
  const pageRes = await fetchWithTimeout(
    `https://www.youtube.com/watch?v=${videoId}`,
    { headers: { "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8" } },
    15000
  );
  const html = await pageRes.text();

  const match = html.match(/"captionTracks":\s*(\[.*?\])/);
  if (!match) return null;

  let tracks: Array<{ baseUrl: string; languageCode: string }>;
  try {
    tracks = JSON.parse(match[1]);
  } catch {
    return null;
  }

  if (!tracks.length) return null;

  // 한국어 → 영어 → 첫 번째 트랙 순으로 선택
  const track =
    tracks.find((t) => t.languageCode === "ko") ??
    tracks.find((t) => t.languageCode === "en") ??
    tracks[0];

  // 2단계: 자막 XML 다운로드 및 파싱
  const xmlRes = await fetchWithTimeout(track.baseUrl + "&fmt=json3", {}, 15000);
  if (!xmlRes.ok) return null;

  interface Json3Response {
    events?: Array<{ segs?: Array<{ utf8?: string }> }>;
  }
  const json = (await xmlRes.json()) as Json3Response;
  if (!json.events) return null;

  const text = json.events
    .flatMap((e) => e.segs ?? [])
    .map((s) => s.utf8 ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return text.length > 100 ? text.slice(0, 4000) : null;
}
