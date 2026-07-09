import type { Entry, KeyDate, KnowledgeItem, BriefingContent } from "@/lib/types";
import type { AskArgusAnswer } from "@/lib/ask-types";
import { JURISDICTIONS, STATUSES, IMPACT_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";

// Paste-ready markdown formatters. The deliverable is a Slack/email message,
// so the dialect is deliberately conservative: bold lines as headings (Slack
// doesn't render `#` headings), hyphen bullets, one metadata line up top, one
// sources line at the bottom. Deterministic assembly from existing fields —
// no model call, so copy is instant.

function jurisdictionLabel(code: string): string {
  const j = JURISDICTIONS.find((j) => j.code === code);
  return j ? `${j.flag} ${j.name}` : code;
}

function statusLabel(value: string): string {
  return STATUSES.find((s) => s.value === value)?.label || value.replace(/_/g, " ");
}

function section(heading: string, body: string | null | undefined): string[] {
  if (!body?.trim()) return [];
  return [`**${heading}**`, body.trim(), ""];
}

function sourceLabel(label: string | undefined, url: string): string {
  if (label) return label;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function keyDatesLines(keyDates: KeyDate[] | null): string[] {
  if (!keyDates?.length) return [];
  const upcoming = [...keyDates].sort((a, b) => a.date.localeCompare(b.date));
  return [
    "**Key dates**",
    ...upcoming.map((d) => `- ${formatDate(d.date)} — ${d.label}`),
    "",
  ];
}

export function entryToMarkdown(entry: Entry): string {
  const lines: string[] = [];

  lines.push(`**${entry.shortName}**${entry.formalCitation ? ` — ${entry.formalCitation}` : ""}`);
  if (entry.fullName && entry.fullName !== entry.shortName) {
    lines.push(`_${entry.fullName}_`);
  }

  const meta = [
    jurisdictionLabel(entry.jurisdiction),
    statusLabel(entry.status),
    entry.category,
    entry.regulator || null,
    entry.impactScore ? `Impact: ${IMPACT_LABELS[entry.impactScore] || entry.impactScore}` : null,
  ].filter(Boolean);
  lines.push(meta.join(" · "), "");

  lines.push(...section("Summary", entry.summary));
  lines.push(...section("For us", entry.impactOnUs));
  lines.push(...section("For our customers", entry.impactOnCustomers));
  lines.push(...section("Why it matters", entry.whyItMatters));
  lines.push(...keyDatesLines(entry.keyDates));
  lines.push(...section("Who it applies to", entry.applicability));
  lines.push(...section("Key criteria", entry.keyCriteria));
  lines.push(...section("Compliance implications", entry.complianceImplications));
  lines.push(...section("Exemptions", entry.exemptions));
  lines.push(...section("Penalties", entry.penalties));

  const sources = (entry.sourceUrls || []).filter((s) => s.url);
  if (sources.length > 0) {
    lines.push(
      "Sources: " + sources.map((s) => `[${sourceLabel(s.label, s.url)}](${s.url})`).join(" · ")
    );
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function askAnswerToMarkdown(answer: AskArgusAnswer): string {
  const lines: string[] = [];

  lines.push(`**${answer.query}**`, "");
  lines.push(answer.summary.trim(), "");
  lines.push(...section("Why it matters", answer.whyItMatters));

  if (answer.reportSections?.length) {
    for (const s of answer.reportSections) {
      lines.push(...section(s.heading, s.content));
    }
  }

  if (answer.actions.length > 0) {
    lines.push("**Suggested actions**");
    for (const a of answer.actions) {
      lines.push(`- ${a.title}${a.detail ? ` — ${a.detail}` : ""}`);
    }
    lines.push("");
  }

  if (answer.citations.length > 0) {
    lines.push(
      "Sources: " +
        answer.citations
          .map((c) => (c.externalUrl ? `[${c.title}](${c.externalUrl})` : c.title))
          .join(" · ")
    );
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Paste-ready markdown for a briefing artifact. Assembled deterministically
 * from the stored structured content (no model call), so "Copy" is instant and
 * mirrors what the rendered document shows.
 */
export function briefingToMarkdown(item: KnowledgeItem): string {
  const lines: string[] = [];

  lines.push(`**${item.title}**`);
  const meta: string[] = [];
  if (item.periodFrom && item.periodTo) {
    meta.push(`${formatDate(item.periodFrom)} – ${formatDate(item.periodTo)}`);
  }
  if (item.jurisdiction) meta.push(jurisdictionLabel(item.jurisdiction));
  meta.push(`${Math.round((item.groundingRatio || 0) * 100)}% grounded · ${item.confidence} confidence`);
  lines.push(meta.join(" · "), "");

  let content: BriefingContent | null = null;
  try {
    content = JSON.parse(item.content) as BriefingContent;
  } catch {
    /* fall back to raw content below */
  }

  if (content?.sections?.length) {
    for (const s of content.sections) {
      lines.push(`**${s.heading}**`);
      for (const it of s.items) {
        const src = it.entryName
          ? ` (${it.entryName}${it.sourceSection ? `, ${it.sourceSection}` : ""})`
          : "";
        lines.push(`- ${it.claim}${src}`);
      }
      lines.push("");
    }
  } else {
    lines.push(item.content.trim(), "");
  }

  lines.push(
    `_Generated by Argus${item.lastGenerated ? ` on ${formatDate(item.lastGenerated)}` : ""}._`
  );

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
