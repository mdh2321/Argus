// Delivery for the weekly digest: Telegram summary (Telegram-only by
// decision, July 2026 — no email path). A read-only surface — every story
// deep-links to its card on /digest/issues/[slug]#storyId, where stars /
// Ask / tracker links live.
import fs from "fs";
import os from "os";
import path from "path";
import { db } from "@/db";
import { digestIssues, digestStories } from "@/db/schema";
import { desc, eq, isNotNull } from "drizzle-orm";
import { getFlag } from "@/lib/digest-utils";

// How many top stories are numbered in the Telegram digest and therefore
// addressable via a `track <n>` reply (D3).
const TRACKABLE_TOP_N = 5;

const BASE_URL = process.env.SENTINEL_BASE_URL ?? "http://localhost:3000";

export type ChannelStatus = "sent" | "skipped" | "failed";

export interface DeliveryResult {
  telegram: ChannelStatus;
  errors: string[];
}

interface IssueRow {
  id: string;
  slug: string;
  title: string;
  weekOf: string;
  synopsis: string | null;
  executiveBrief: string | null;
  storyCount: number | null;
  jurisdictionCount: number | null;
}

interface StoryRow {
  id: string;
  title: string;
  url: string | null;
  source: string;
  summary: string;
  takeaways: string | null;
  jurisdictionCode: string | null;
  urgency: string | null;
  impact: string | null;
  complianceDeadline: string | null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function deliverDigest(issueId: string): Promise<DeliveryResult> {
  const issue = db.select().from(digestIssues).where(eq(digestIssues.id, issueId)).limit(1).all()[0];
  if (!issue) throw new Error(`deliverDigest: issue ${issueId} not found`);
  const stories = sortStories(
    db.select().from(digestStories).where(eq(digestStories.issueId, issueId)).all()
  );

  const result: DeliveryResult = { telegram: "skipped", errors: [] };

  try {
    result.telegram = await sendTelegramDigest(issue, stories);
  } catch (err) {
    result.telegram = "failed";
    result.errors.push(`telegram: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/** Telegram alert when a run fails — a broken week must never be silent. */
export async function sendFailureAlert(message: string): Promise<ChannelStatus> {
  try {
    return await sendTelegramMessage(
      `<b>⚠️ Argus digest run failed</b>\n\n<pre>${escapeHtml(message.slice(0, 3000))}</pre>\n\nWill retry on the next daily run.`
    );
  } catch (err) {
    console.error("[deliver] failure alert itself failed:", err);
    return "failed";
  }
}

// ─── Ordering (mirrors the issue page: Tier 1 first, impact-sorted) ─────────

const TIER1 = ["AU", "SG", "JP"];
const IMPACT_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

function sortStories(stories: StoryRow[]): StoryRow[] {
  const byJurisdiction = new Map<string, StoryRow[]>();
  for (const s of stories) {
    const code = s.jurisdictionCode || "OTHER";
    if (!byJurisdiction.has(code)) byJurisdiction.set(code, []);
    byJurisdiction.get(code)!.push(s);
  }
  for (const group of byJurisdiction.values()) {
    group.sort((a, b) => (IMPACT_RANK[a.impact ?? ""] ?? 99) - (IMPACT_RANK[b.impact ?? ""] ?? 99));
  }
  const order = [
    ...TIER1.filter((c) => byJurisdiction.has(c)),
    ...[...byJurisdiction.keys()].filter((c) => !TIER1.includes(c)).sort(),
  ];
  return order.flatMap((c) => byJurisdiction.get(c)!);
}

function storyUrl(slug: string, storyId: string): string {
  return `${BASE_URL}/digest/issues/${slug}#${storyId}`;
}

function issueUrl(slug: string): string {
  return `${BASE_URL}/digest/issues/${slug}`;
}

function parseJsonArray(text: string | null): string[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Telegram ────────────────────────────────────────────────────────────────

function telegramToken(): string | null {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  // Shared with the Claude Code Telegram channel on this machine.
  const envFile = path.join(os.homedir(), ".claude/channels/telegram/.env");
  try {
    const line = fs.readFileSync(envFile, "utf-8").split("\n").find((l) => l.startsWith("TELEGRAM_BOT_TOKEN="));
    return line ? line.slice("TELEGRAM_BOT_TOKEN=".length).trim() : null;
  } catch {
    return null;
  }
}

async function sendTelegramDigest(issue: IssueRow, stories: StoryRow[]): Promise<ChannelStatus> {
  // Number the top stories 1..N so a reply can address one with `track <n>`.
  const top = stories
    .slice(0, TRACKABLE_TOP_N)
    .map(
      (s, i) =>
        `${i + 1}. ${getFlag(s.jurisdictionCode || "")} <a href="${storyUrl(issue.slug, s.id)}">${escapeHtml(s.title)}</a>${s.impact === "High" ? " 🔴" : ""}`
    )
    .join("\n");
  const synopsis = parseJsonArray(issue.synopsis)
    .map((s) => `– ${escapeHtml(s)}`)
    .join("\n");

  const text = `<b>📋 ${escapeHtml(issue.title)}</b>
<i>Argus digest · week of ${escapeHtml(issue.weekOf)}</i>

${synopsis}

<b>Top stories</b>
${top}

<a href="${issueUrl(issue.slug)}">Read the full issue in Argus</a>

<i>Reply <code>track 3</code> to add story 3 to the tracker.</i>`;

  return sendTelegramMessage(text);
}

// ─── D3: two-way "track <n>" support ────────────────────────────────────────

/**
 * Resolve the nth numbered story (1-indexed) from the most recently delivered
 * digest issue — the same ordering used in the Telegram message — so a
 * `track <n>` reply maps deterministically to a story.
 */
export function getDeliveredDigestStory(n: number): { story: StoryRow; issue: IssueRow } | null {
  if (!Number.isInteger(n) || n < 1 || n > TRACKABLE_TOP_N) return null;
  const issue = db
    .select()
    .from(digestIssues)
    .where(isNotNull(digestIssues.deliveredAt))
    .orderBy(desc(digestIssues.deliveredAt))
    .limit(1)
    .all()[0];
  if (!issue) return null;
  const stories = sortStories(
    db.select().from(digestStories).where(eq(digestStories.issueId, issue.id)).all()
  );
  const story = stories.slice(0, TRACKABLE_TOP_N)[n - 1];
  if (!story) return null;
  return { story, issue };
}

/** Send a Telegram reply to a specific chat (used by the inbound webhook). */
export async function sendTelegramReply(
  chatId: string | number,
  html: string,
  replyToMessageId?: number
): Promise<ChannelStatus> {
  const token = telegramToken();
  if (!token) return "skipped";
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: html.slice(0, 4000),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
    }),
  });
  const body = (await res.json()) as { ok: boolean; description?: string };
  if (!res.ok || !body.ok) {
    throw new Error(`Telegram reply failed: ${body.description ?? res.status}`);
  }
  return "sent";
}

async function sendTelegramMessage(html: string): Promise<ChannelStatus> {
  const token = telegramToken();
  const chatId = process.env.DIGEST_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[deliver] Telegram token / DIGEST_TELEGRAM_CHAT_ID not set — skipping telegram");
    return "skipped";
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: html.slice(0, 4000),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }),
  });
  const body = (await res.json()) as { ok: boolean; description?: string };
  if (!res.ok || !body.ok) {
    throw new Error(`Telegram sendMessage failed: ${body.description ?? res.status}`);
  }
  console.log("[deliver] telegram message sent");
  return "sent";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
