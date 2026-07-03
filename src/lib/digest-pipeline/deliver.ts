// Delivery for the weekly digest: email (Resend) + Telegram summary.
// Both channels are read-only surfaces — every story deep-links to its card
// on /digest/issues/[slug]#storyId, where stars / Ask / tracker links live.
import fs from "fs";
import os from "os";
import path from "path";
import { db } from "@/db";
import { digestIssues, digestStories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getFlag, getJurisdictionName } from "@/lib/digest-utils";

const BASE_URL = process.env.SENTINEL_BASE_URL ?? "http://localhost:3000";

export type ChannelStatus = "sent" | "skipped" | "failed";

export interface DeliveryResult {
  email: ChannelStatus;
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

  const result: DeliveryResult = { email: "skipped", telegram: "skipped", errors: [] };

  try {
    result.email = await sendEmail(issue, stories);
  } catch (err) {
    result.email = "failed";
    result.errors.push(`email: ${err instanceof Error ? err.message : String(err)}`);
  }

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
      `<b>⚠️ Sentinel digest run failed</b>\n\n<pre>${escapeHtml(message.slice(0, 3000))}</pre>\n\nWill retry on the next daily run.`
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

// ─── Email (Resend) ──────────────────────────────────────────────────────────

async function sendEmail(issue: IssueRow, stories: StoryRow[]): Promise<ChannelStatus> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DIGEST_EMAIL_TO;
  if (!apiKey || !to) {
    console.warn("[deliver] RESEND_API_KEY / DIGEST_EMAIL_TO not set — skipping email");
    return "skipped";
  }
  const from = process.env.DIGEST_EMAIL_FROM ?? "Sentinel Digest <onboarding@resend.dev>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `${issue.title} — Sentinel Digest, week of ${issue.weekOf}`,
      html: buildEmailHtml(issue, stories),
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  console.log(`[deliver] email sent to ${to}`);
  return "sent";
}

function buildEmailHtml(issue: IssueRow, stories: StoryRow[]): string {
  const synopsis = parseJsonArray(issue.synopsis);
  const deadlines = stories.filter((s) => s.complianceDeadline);

  const badge = (text: string, color: string) =>
    `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-family:monospace;background:${color}1a;color:${color};border:1px solid ${color}55;">${escapeHtml(text)}</span>`;

  const impactColor: Record<string, string> = { High: "#ff3b5c", Medium: "#ff6b35", Low: "#6b7280" };
  const urgencyLabel: Record<string, string> = {
    immediate_action: "act now",
    monitor_closely: "monitor",
    awareness_only: "awareness",
  };

  let currentCode = "";
  const storyBlocks = stories
    .map((s) => {
      const code = s.jurisdictionCode || "OTHER";
      const header =
        code !== currentCode
          ? `<h2 style="margin:28px 0 8px;font-size:16px;color:#111;">${getFlag(code)} ${escapeHtml(getJurisdictionName(code) || code)}</h2>`
          : "";
      currentCode = code;
      const takeaways = parseJsonArray(s.takeaways)
        .map((t) => `<li style="margin:2px 0;color:#374151;font-size:13px;">${escapeHtml(t)}</li>`)
        .join("");
      return `${header}
<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:10px 0;">
  <div style="margin-bottom:6px;">
    <a href="${storyUrl(issue.slug, s.id)}" style="font-size:15px;font-weight:600;color:#111;text-decoration:none;">${escapeHtml(s.title)}</a>
  </div>
  <div style="margin-bottom:8px;">
    ${s.impact ? badge(s.impact, impactColor[s.impact] ?? "#6b7280") : ""}
    ${s.urgency ? badge(urgencyLabel[s.urgency] ?? s.urgency, "#00875f") : ""}
    ${s.complianceDeadline ? badge(`deadline ${s.complianceDeadline}`, "#8b5cf6") : ""}
    <span style="font-size:12px;color:#9ca3af;">${escapeHtml(s.source)}</span>
  </div>
  <p style="margin:0 0 6px;font-size:14px;line-height:1.55;color:#374151;">${escapeHtml(s.summary)}</p>
  ${takeaways ? `<ul style="margin:6px 0 0;padding-left:18px;">${takeaways}</ul>` : ""}
  <div style="margin-top:8px;font-size:12px;">
    <a href="${storyUrl(issue.slug, s.id)}" style="color:#00875f;">Open in Sentinel →</a>
    ${s.url ? ` &nbsp;·&nbsp; <a href="${escapeHtml(s.url)}" style="color:#6b7280;">Source</a>` : ""}
  </div>
</div>`;
    })
    .join("\n");

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f8;">
<div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="font-family:monospace;font-size:11px;letter-spacing:1px;color:#6b7280;text-transform:uppercase;">Sentinel · APAC Legal Digest · Week of ${escapeHtml(issue.weekOf)}</div>
  <h1 style="margin:8px 0 16px;font-size:24px;line-height:1.2;color:#111;">${escapeHtml(issue.title)}</h1>

  ${synopsis.length ? `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;margin-bottom:16px;">
    <div style="font-family:monospace;font-size:11px;color:#6b7280;text-transform:uppercase;margin-bottom:8px;">Synopsis</div>
    <ul style="margin:0;padding-left:18px;">${synopsis.map((s) => `<li style="margin:3px 0;font-size:14px;color:#374151;">${escapeHtml(s)}</li>`).join("")}</ul>
  </div>` : ""}

  ${deadlines.length ? `<div style="background:#fff;border:1px solid #8b5cf655;border-radius:10px;padding:14px 18px;margin-bottom:16px;">
    <div style="font-family:monospace;font-size:11px;color:#8b5cf6;text-transform:uppercase;margin-bottom:8px;">Dates to diarise</div>
    <ul style="margin:0;padding-left:18px;">${deadlines.map((s) => `<li style="margin:3px 0;font-size:13px;color:#374151;"><strong>${escapeHtml(s.complianceDeadline!)}</strong> — <a href="${storyUrl(issue.slug, s.id)}" style="color:#374151;">${escapeHtml(s.title)}</a></li>`).join("")}</ul>
  </div>` : ""}

  ${issue.executiveBrief ? `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;margin-bottom:8px;">
    <div style="font-family:monospace;font-size:11px;color:#6b7280;text-transform:uppercase;margin-bottom:8px;">Executive Brief</div>
    ${issue.executiveBrief.split(/\n+/).filter((p) => p.trim()).map((p) => `<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#374151;">${escapeHtml(p)}</p>`).join("")}
  </div>` : ""}

  ${storyBlocks}

  <div style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
    ${issue.storyCount ?? stories.length} stories · ${issue.jurisdictionCount ?? "?"} jurisdictions ·
    <a href="${issueUrl(issue.slug)}" style="color:#00875f;">Read in Sentinel</a> — stars, Ask &amp; tracker links live there.
  </div>
</div>
</body></html>`;
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
  const top = stories
    .slice(0, 5)
    .map((s) => `• ${getFlag(s.jurisdictionCode || "")} <a href="${storyUrl(issue.slug, s.id)}">${escapeHtml(s.title)}</a>${s.impact === "High" ? " 🔴" : ""}`)
    .join("\n");
  const synopsis = parseJsonArray(issue.synopsis)
    .map((s) => `– ${escapeHtml(s)}`)
    .join("\n");

  const text = `<b>📋 ${escapeHtml(issue.title)}</b>
<i>Sentinel digest · week of ${escapeHtml(issue.weekOf)}</i>

${synopsis}

<b>Top stories</b>
${top}

<a href="${issueUrl(issue.slug)}">Read the full issue in Sentinel</a>`;

  return sendTelegramMessage(text);
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
