import "server-only";

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { getCompanyContext, getCompanyMeta } from "@/lib/company-context";

// Voice-shifted story transforms: LinkedIn post / internal email drafts for a
// digest story. Deliberately separate from markdown-export.ts — that path is
// deterministic paste-ready formatting; this one rewrites in the user's own
// voice, which needs a model. Drafts are always copy-only, never auto-posted.

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

export type ShareFormat = "linkedin" | "email";

export interface ShareStoryInput {
  title: string;
  summary: string;
  takeaways: string[];
  url: string | null;
  source: string;
  jurisdiction: string | null;
  impact: string | null;
  complianceDeadline: string | null;
}

const VOICE_PATH = path.join(process.cwd(), "data", "voice.md");

// Samples the user hasn't replaced yet must not become few-shot examples.
const PLACEHOLDER_MARKERS = ["(none yet", "Replace with your real"];

function loadVoiceSamples(format: ShareFormat): string {
  let raw: string;
  try {
    raw = fs.readFileSync(VOICE_PATH, "utf-8");
  } catch {
    return "";
  }

  const heading = format === "linkedin" ? "## LinkedIn samples" : "## Email samples";
  const start = raw.indexOf(heading);
  if (start < 0) return "";
  const afterHeading = start + heading.length;
  const nextHeading = raw.indexOf("\n## ", afterHeading);
  let section = raw.slice(afterHeading, nextHeading < 0 ? raw.length : nextHeading);

  section = section.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!section || PLACEHOLDER_MARKERS.some((m) => section.includes(m))) return "";
  return section;
}

const SHARED_STYLE_RULES = `HARD STYLE RULES — violating any of these makes the draft unusable:
- Write like a practitioner who actually read the source and has a stake in it, not like a commentator summarising it.
- No AI-tells: never open with "Exciting news", "Delighted to share", "In today's rapidly evolving regulatory landscape", or any variant. No "game-changer", "important reminder that", "key takeaway", "navigate the complexities", "stay tuned".
- No rhetorical-question openers. No "Let's dive in". Never end with "Thoughts?"
- One concrete detail (a number, a date, a named obligation) beats three abstractions. Lead with the concrete.
- Vary sentence length. Contractions are fine. Plain words over formal ones ("use" not "utilise", "before" not "prior to").
- Do not restate the same point twice in different words. Say it once, well.
- No em-dash-chained triads ("fast — cheap — reliable"). No triadic lists of abstract nouns.
- State facts without hedging filler ("it's worth noting that", "it remains to be seen").
- If something is uncertain, say specifically what is unknown and when it will be known.`;

const LINKEDIN_RULES = `FORMAT — LinkedIn post:
- 60–120 words. Short paragraphs, blank line between them. No headline line, no title case.
- First line: the most concrete, consequential fact — it must work standing alone above the fold.
- Perspective allowed: what this means in practice for companies operating in the region. No legal advice, no naming the author's employer's internal plans.
- No emoji, no hashtags, unless the voice samples use them — then match the samples' pattern exactly.
- End with the source link on its own final line, nothing after it.`;

const EMAIL_RULES = `FORMAT — internal email to legal/business stakeholders:
- First line: "Subject: " followed by a specific subject (what changed + jurisdiction), max 10 words.
- Then 2 short paragraphs: (1) what changed, who it binds, from when; (2) what it means for us and our customers.
- Then, only if the story implies action: "Next steps:" with 2-3 verb-led bullets.
- 150 words max after the subject line. No greeting, no sign-off — the sender adds those.
- Include the source link at the end.`;

function buildSystemPrompt(format: ShareFormat): string {
  const companyContext = getCompanyContext();
  const meta = getCompanyMeta();
  const samples = loadVoiceSamples(format);

  const parts: string[] = [
    `You draft ${format === "linkedin" ? "LinkedIn posts" : "internal update emails"} for an in-house legal counsel at ${meta.name}. The draft will be reviewed and edited before sending — your job is to get it 95% there in their voice.`,
  ];

  if (companyContext) {
    parts.push(`<company_context>\n${companyContext}\n</company_context>`);
  }

  if (samples) {
    parts.push(`<voice_samples>\n${samples}\n</voice_samples>\n\nMatch the register, rhythm, sentence length, and vocabulary of the voice samples. They override any generic style instinct you have. If the samples are informal, be informal.`);
  }

  parts.push(SHARED_STYLE_RULES);
  parts.push(format === "linkedin" ? LINKEDIN_RULES : EMAIL_RULES);
  parts.push("Return ONLY the draft text. No preamble, no options, no commentary.");

  return parts.join("\n\n");
}

export async function draftShare(story: ShareStoryInput, format: ShareFormat): Promise<string> {
  const storyBlock = [
    `Title: ${story.title}`,
    `Jurisdiction: ${story.jurisdiction ?? "n/a"}`,
    `Source: ${story.source}`,
    `URL: ${story.url ?? "n/a"}`,
    `Impact: ${story.impact ?? "n/a"}`,
    story.complianceDeadline ? `Compliance deadline: ${story.complianceDeadline}` : null,
    `Summary: ${story.summary}`,
    story.takeaways.length > 0 ? `Takeaways:\n${story.takeaways.map((t) => `- ${t}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: buildSystemPrompt(format),
    messages: [
      {
        role: "user",
        content: `Draft a ${format === "linkedin" ? "LinkedIn post" : "stakeholder email"} from this digest story:\n\n${storyBlock}`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  if (!text) throw new Error("Empty draft from model");
  return text;
}
