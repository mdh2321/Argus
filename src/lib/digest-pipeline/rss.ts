// B1 RSS pre-seed layer. Regulator feeds are ground truth for "did we miss an
// announcement" — regulator pages often lack published metadata, so Exa's
// date filter silently drops them. Feed items inside the digest week are
// injected into the extraction prompt as pre-seeded stories. Zero AI cost.
//
// Deliberately dependency-free: handles the two dialects the registry
// actually contains (RSS 2.0 <item><pubDate>, RDF/RSS 1.0 <item><dc:date>)
// with regex extraction, plus Shift_JIS decoding for Japanese feeds.

import { RSS_FEEDS } from "./config";

export interface RssItem {
  title: string;
  url: string;
  publishedDate: string | null; // ISO YYYY-MM-DD when parseable
  summary: string;
  feedUrl: string;
}

const FEED_TIMEOUT_MS = 10_000;

export async function pullFeeds(
  jurisdictionCode: string,
  weekStart: string,
  weekEnd: string
): Promise<RssItem[]> {
  const feeds = RSS_FEEDS[jurisdictionCode] ?? [];
  if (feeds.length === 0) return [];

  const results = await Promise.all(
    feeds.map(async (feedUrl) => {
      try {
        const xml = await fetchFeed(feedUrl);
        return parseFeed(xml, feedUrl);
      } catch (err) {
        console.warn(
          `[digest][${jurisdictionCode}][rss] feed failed ${feedUrl}:`,
          err instanceof Error ? err.message : String(err)
        );
        return [] as RssItem[];
      }
    })
  );

  const seen = new Set<string>();
  return results
    .flat()
    .filter((item) => {
      // Keep only items dated inside the digest week. Undated items are
      // dropped — the whole point of RSS here is reliable dates.
      if (!item.publishedDate) return false;
      if (item.publishedDate < weekStart || item.publishedDate > weekEnd) return false;
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
}

/** Format week-window items for the prompt's preSeededStories slot. */
export function formatPreSeededStories(items: RssItem[]): string {
  if (items.length === 0) return "";
  return items
    .map(
      (item, i) => `--- PRE-SEEDED ${i + 1} (regulator RSS — treat the date and source as reliable) ---
URL: ${item.url}
Title: ${item.title}
Published: ${item.publishedDate}
Summary: ${item.summary || "(none)"}`
    )
    .join("\n\n");
}

async function fetchFeed(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    headers: { "User-Agent": "Mozilla/5.0 (Argus digest)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  // Sniff the encoding from the XML declaration; Japanese feeds ship Shift_JIS.
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 200));
  const encMatch = head.match(/encoding=["']([\w-]+)["']/i);
  const encoding = encMatch ? encMatch[1].toLowerCase() : "utf-8";
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function parseFeed(xml: string, feedUrl: string): RssItem[] {
  if (!/<(rss|rdf:RDF|feed)[\s>]/i.test(xml)) {
    throw new Error("not an XML feed");
  }
  const items: RssItem[] = [];
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemBlocks) {
    const title = tag(block, "title");
    const link = tag(block, "link");
    if (!title || !link) continue;
    const dateRaw = tag(block, "pubDate") ?? tag(block, "dc:date") ?? tag(block, "date");
    items.push({
      title,
      url: link,
      publishedDate: toIsoDate(dateRaw),
      summary: (tag(block, "description") ?? "").slice(0, 300),
      feedUrl,
    });
  }
  return items;
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return null;
  // Unescape entities before stripping tags — feeds ship HTML-escaped markup
  // inside <description>, which only becomes tags after unescaping.
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
