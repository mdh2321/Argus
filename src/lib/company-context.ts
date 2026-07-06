import fs from "fs";
import path from "path";

// Canonical company context lives in data/company-context.md — one rich MD
// file consumed by every AI surface (digest pipeline, Ask, Scan, Capture,
// Signals, …). The user_profile DB row is the fallback when the file is
// absent. No "server-only" here: the digest pipeline imports this from tsx
// scripts outside the Next.js runtime.

const FILE_PATH = path.join(process.cwd(), "data", "company-context.md");

export interface CompanyMeta {
  name: string;
  descriptor: string;
}

interface CachedContext {
  mtimeMs: number;
  raw: string;
  body: string;
  meta: CompanyMeta;
}

let cache: CachedContext | null = null;

const DEFAULT_META: CompanyMeta = { name: "the company", descriptor: "" };

function load(): CachedContext | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(FILE_PATH);
  } catch {
    cache = null;
    return null;
  }
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache;

  const raw = fs.readFileSync(FILE_PATH, "utf-8");
  const { body, meta } = parseFrontmatter(raw);
  cache = { mtimeMs: stat.mtimeMs, raw, body, meta };
  return cache;
}

function parseFrontmatter(raw: string): { body: string; meta: CompanyMeta } {
  const meta = { ...DEFAULT_META };
  if (!raw.startsWith("---")) return { body: raw.trim(), meta };

  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { body: raw.trim(), meta };

  const header = raw.slice(3, end);
  for (const line of header.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === "company" && value) meta.name = value;
    if (key === "descriptor" && value) meta.descriptor = value;
  }
  const body = raw.slice(end + 4).replace(/^-*\n?/, "").trim();
  return { body, meta };
}

/** Full context body (frontmatter stripped), or null when the file is absent. */
export function getCompanyContext(): string | null {
  return load()?.body ?? null;
}

export function getCompanyMeta(): CompanyMeta {
  return load()?.meta ?? DEFAULT_META;
}

/** Raw file content including frontmatter — for the Settings editor. */
export function getCompanyContextRaw(): string | null {
  return load()?.raw ?? null;
}

export function writeCompanyContextRaw(content: string): void {
  fs.writeFileSync(FILE_PATH, content, "utf-8");
  cache = null;
}

const FEEDBACK_HEADING = "## Relevance feedback";
const MAX_FEEDBACK_ITEMS = 30;

/**
 * Append a "not relevant" example under the Relevance feedback heading.
 * Newest first, capped so the section can't grow without bound. Creates the
 * section if the user deleted it.
 */
export function appendRelevanceFeedback(line: string): void {
  const current = load();
  if (!current) throw new Error(`Company context file not found at ${FILE_PATH}`);

  const entry = `- ${line.replace(/\n+/g, " ").trim()}`;
  let raw = current.raw;

  const headingIdx = raw.indexOf(FEEDBACK_HEADING);
  if (headingIdx < 0) {
    raw = `${raw.trimEnd()}\n\n${FEEDBACK_HEADING}\n\nStories the user marked not relevant — treat similar stories as low priority or exclude. (Auto-maintained; newest first.)\n\n${entry}\n`;
    writeCompanyContextRaw(raw);
    return;
  }

  // Section runs from the heading to the next "## " heading or EOF.
  const afterHeading = headingIdx + FEEDBACK_HEADING.length;
  const nextHeading = raw.indexOf("\n## ", afterHeading);
  const sectionEnd = nextHeading < 0 ? raw.length : nextHeading;
  const section = raw.slice(afterHeading, sectionEnd);

  const lines = section.split("\n");
  const bullets = lines.filter((l) => l.trimStart().startsWith("- "));
  const prose = lines.filter((l) => !l.trimStart().startsWith("- ") && l.trim() !== "");

  const newBullets = [entry, ...bullets].slice(0, MAX_FEEDBACK_ITEMS);
  const rebuilt = `\n\n${prose.join("\n")}\n\n${newBullets.join("\n")}\n`;

  writeCompanyContextRaw(raw.slice(0, afterHeading) + rebuilt + raw.slice(sectionEnd));
}
