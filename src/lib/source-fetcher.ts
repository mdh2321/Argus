import Exa from "exa-js";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { createHash } from "crypto";

// 1 MB byte cap on stored full text. Truncate beyond.
export const MAX_FULLTEXT_BYTES = 1_000_000;

// Direct-fetch budget. Keeps a hung server from stalling the whole pipeline.
const DIRECT_FETCH_TIMEOUT_MS = 30_000;

export type Extractor = "exa" | "direct-html" | "direct-pdf" | "direct-text";

export interface FetchResult {
  /** Canonical URL after redirects (Exa or HTTP). Falls back to input URL. */
  url: string;
  title: string | null;
  fullText: string | null;
  contentHash: string | null;
  byteCount: number | null;
  fetchedAt: string;
  /** True when SOMETHING was successfully retrieved from the source. */
  ok: boolean;
  /** True when non-empty text was extracted. */
  extracted: boolean;
  /** True when the saved text was truncated by MAX_FULLTEXT_BYTES. */
  truncated: boolean;
  /** Which extractor produced the text (null when extracted=false). */
  extractor: Extractor | null;
  /** Diagnostic message when extracted=false; also kept on success for trace. */
  error: string | null;
}

let _client: Exa | null = null;
function client(): Exa | null {
  if (_client) return _client;
  const key = process.env.EXA_API_KEY;
  if (!key) return null;
  _client = new Exa(key);
  return _client;
}

/**
 * Fetch a URL and extract its readable text. Tries Exa first (handles
 * JS-rendered pages, paywalls, PDFs uniformly), then falls back to a direct
 * HTTP fetch with Readability for HTML and pdf-parse for PDFs.
 *
 * Domains that block Exa's crawler (e.g. legislation.govt.nz) are reachable
 * via the direct fallback. The function never throws — every failure mode is
 * encoded in the returned FetchResult so callers can branch on `extracted`.
 */
export async function fetchAndExtract(url: string): Promise<FetchResult> {
  const fetchedAt = new Date().toISOString();
  const errors: string[] = [];

  const exa = await tryExa(url, fetchedAt);
  if (exa.extracted) return exa;
  if (exa.error) errors.push(`exa: ${exa.error}`);

  const direct = await tryDirect(url, fetchedAt);
  if (direct.extracted) return direct;
  if (direct.error) errors.push(`direct: ${direct.error}`);

  // Neither path produced text. Prefer the direct result's URL (it actually
  // resolved redirects via HTTP) over Exa's, then surface combined errors so
  // the user sees what was tried.
  const fallback = direct.ok || direct.url !== url ? direct : exa;
  return {
    ...fallback,
    fullText: null,
    contentHash: null,
    byteCount: null,
    extracted: false,
    truncated: false,
    extractor: null,
    error: errors.length > 0 ? errors.join(" | ") : "No extractor produced text",
  };
}

async function tryExa(url: string, fetchedAt: string): Promise<FetchResult> {
  const c = client();
  if (!c) {
    return baseResult(url, fetchedAt, "EXA_API_KEY not set");
  }
  try {
    const response = await c.getContents([url], {
      // Exa rejects maxCharacters above 1,000,000.
      text: { maxCharacters: 1_000_000, includeHtmlTags: false },
      livecrawl: "preferred",
    });

    const result = response.results?.[0];
    if (!result) {
      const status = response.statuses?.[0];
      const statusErr =
        status && typeof status === "object" && "status" in status
          ? `status=${(status as { status: string }).status}`
          : "no result";
      return baseResult(url, fetchedAt, `Exa returned no results (${statusErr})`);
    }

    const rawText = typeof result.text === "string" ? result.text.trim() : "";
    if (rawText.length === 0) {
      return {
        url: result.url ?? url,
        title: result.title ?? null,
        fullText: null,
        contentHash: null,
        byteCount: null,
        fetchedAt,
        ok: true,
        extracted: false,
        truncated: false,
        extractor: null,
        error: "Page reachable but no text extracted",
      };
    }

    const { text, truncated, byteCount } = capToBytes(rawText);
    return {
      url: result.url ?? url,
      title: result.title ?? null,
      fullText: text,
      contentHash: sha256(text),
      byteCount,
      fetchedAt,
      ok: true,
      extracted: true,
      truncated,
      extractor: "exa",
      error: null,
    };
  } catch (err) {
    return baseResult(url, fetchedAt, err instanceof Error ? err.message : String(err));
  }
}

async function tryDirect(url: string, fetchedAt: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        // Real-browser UA + Accept so prudish servers don't 403 us. Some legal
        // sites (legislation.govt.nz, lexisnexis mirrors) block bare bot UAs.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 ArgusLegalBot/1.0",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      return baseResult(url, fetchedAt, `HTTP ${response.status} ${response.statusText}`);
    }

    const finalUrl = response.url || url;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();

    if (contentType.includes("application/pdf") || finalUrl.toLowerCase().endsWith(".pdf")) {
      const buf = Buffer.from(await response.arrayBuffer());
      return await extractPdf(finalUrl, fetchedAt, buf);
    }

    if (
      contentType.includes("text/plain") &&
      !contentType.includes("html")
    ) {
      const raw = (await response.text()).trim();
      if (raw.length === 0) {
        return baseResult(finalUrl, fetchedAt, "Empty text/plain response", true);
      }
      const { text, truncated, byteCount } = capToBytes(raw);
      return {
        url: finalUrl,
        title: null,
        fullText: text,
        contentHash: sha256(text),
        byteCount,
        fetchedAt,
        ok: true,
        extracted: true,
        truncated,
        extractor: "direct-text",
        error: null,
      };
    }

    // Default: treat as HTML and run Readability.
    const html = await response.text();
    return extractHtml(finalUrl, fetchedAt, html);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("aborted")) {
      return baseResult(url, fetchedAt, `Direct fetch timed out after ${DIRECT_FETCH_TIMEOUT_MS}ms`);
    }
    return baseResult(url, fetchedAt, msg);
  } finally {
    clearTimeout(timer);
  }
}

function extractHtml(url: string, fetchedAt: string, html: string): FetchResult {
  let title: string | null = null;
  let text = "";
  try {
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;
    title = doc.title?.trim() || null;
    const article = new Readability(doc).parse();
    if (article) {
      title = article.title?.trim() || title;
      text = (article.textContent || "").trim();
    }
    // Readability sometimes returns near-empty content on heavily structured
    // pages (long ToCs, frame-driven layouts). Fall back to body.textContent.
    if (text.length < 200) {
      const body = doc.body?.textContent ?? "";
      const collapsed = body.replace(/\s+/g, " ").trim();
      if (collapsed.length > text.length) text = collapsed;
    }
  } catch (err) {
    return baseResult(
      url,
      fetchedAt,
      `HTML parse failed: ${err instanceof Error ? err.message : String(err)}`,
      true
    );
  }

  if (text.length === 0) {
    return {
      url,
      title,
      fullText: null,
      contentHash: null,
      byteCount: null,
      fetchedAt,
      ok: true,
      extracted: false,
      truncated: false,
      extractor: null,
      error: "Readability produced no text",
    };
  }

  const { text: capped, truncated, byteCount } = capToBytes(text);
  return {
    url,
    title,
    fullText: capped,
    contentHash: sha256(capped),
    byteCount,
    fetchedAt,
    ok: true,
    extracted: true,
    truncated,
    extractor: "direct-html",
    error: null,
  };
}

async function extractPdf(
  url: string,
  fetchedAt: string,
  buf: Buffer
): Promise<FetchResult> {
  try {
    // Lazy require: pdf-parse pulls in heavy bindings, no need to load it
    // unless we actually hit a PDF.
    const pdfParse = (await import("pdf-parse-debugging-disabled")).default as (
      data: Buffer
    ) => Promise<{ text: string; info?: { Title?: string } }>;
    const parsed = await pdfParse(buf);
    const raw = (parsed.text || "").trim();
    if (raw.length === 0) {
      return {
        url,
        title: parsed.info?.Title?.trim() || null,
        fullText: null,
        contentHash: null,
        byteCount: null,
        fetchedAt,
        ok: true,
        extracted: false,
        truncated: false,
        extractor: null,
        error: "PDF produced no text (likely scanned/image-based)",
      };
    }
    const { text, truncated, byteCount } = capToBytes(raw);
    return {
      url,
      title: parsed.info?.Title?.trim() || null,
      fullText: text,
      contentHash: sha256(text),
      byteCount,
      fetchedAt,
      ok: true,
      extracted: true,
      truncated,
      extractor: "direct-pdf",
      error: null,
    };
  } catch (err) {
    return baseResult(
      url,
      fetchedAt,
      `PDF parse failed: ${err instanceof Error ? err.message : String(err)}`,
      true
    );
  }
}

/**
 * Map a FetchResult to the persistence-layer fetch_status enum used by
 * source_documents.fetchStatus. Single source of truth so insert sites stay
 * consistent.
 */
export function deriveFetchStatus(
  result: FetchResult
): "ok" | "no_text" | "fetch_failed" {
  if (result.extracted) return "ok";
  if (result.ok) return "no_text"; // URL reachable but no text
  return "fetch_failed";
}

function baseResult(
  url: string,
  fetchedAt: string,
  error: string,
  ok = false
): FetchResult {
  return {
    url,
    title: null,
    fullText: null,
    contentHash: null,
    byteCount: null,
    fetchedAt,
    ok,
    extracted: false,
    truncated: false,
    extractor: null,
    error,
  };
}

function capToBytes(raw: string): { text: string; truncated: boolean; byteCount: number } {
  const initial = Buffer.byteLength(raw, "utf8");
  if (initial <= MAX_FULLTEXT_BYTES) {
    return { text: raw, truncated: false, byteCount: initial };
  }
  const text = truncateToBytes(raw, MAX_FULLTEXT_BYTES);
  return { text, truncated: true, byteCount: Buffer.byteLength(text, "utf8") };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Truncate `text` so its UTF-8 byte length is at most `maxBytes`,
 * cutting at character boundaries (no broken multibyte chars).
 */
function truncateToBytes(text: string, maxBytes: number): string {
  let bytes = 0;
  let i = 0;
  while (i < text.length) {
    const codePoint = text.codePointAt(i)!;
    const charBytes =
      codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
    if (bytes + charBytes > maxBytes) break;
    bytes += charBytes;
    i += codePoint > 0xffff ? 2 : 1;
  }
  return text.slice(0, i);
}
