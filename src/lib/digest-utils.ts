/**
 * Shared utility functions for digest/pulse display.
 * These are pure formatters with no data dependencies.
 */

// ── Jurisdiction helpers ───────────────────────────────────────

const JURISDICTIONS: Record<string, string> = {
  AU: "Australia",
  SG: "Singapore",
  JP: "Japan",
  CN: "China",
  IN: "India",
  PH: "Philippines",
  ID: "Indonesia",
  HK: "Hong Kong",
  KR: "South Korea",
  NZ: "New Zealand",
  VN: "Vietnam",
  MY: "Malaysia",
  TW: "Taiwan",
  TH: "Thailand",
};

const FLAGS: Record<string, string> = {
  AU: "\u{1F1E6}\u{1F1FA}",
  SG: "\u{1F1F8}\u{1F1EC}",
  JP: "\u{1F1EF}\u{1F1F5}",
  CN: "\u{1F1E8}\u{1F1F3}",
  IN: "\u{1F1EE}\u{1F1F3}",
  PH: "\u{1F1F5}\u{1F1ED}",
  ID: "\u{1F1EE}\u{1F1E9}",
  HK: "\u{1F1ED}\u{1F1F0}",
  KR: "\u{1F1F0}\u{1F1F7}",
  NZ: "\u{1F1F3}\u{1F1FF}",
  VN: "\u{1F1FB}\u{1F1F3}",
  MY: "\u{1F1F2}\u{1F1FE}",
  TW: "\u{1F1F9}\u{1F1FC}",
  TH: "\u{1F1F9}\u{1F1ED}",
};

export function getFlag(code: string): string {
  return FLAGS[code] || "\u{1F30F}";
}

export function getJurisdictionName(code: string): string {
  return JURISDICTIONS[code] || code;
}

// ── Content type helpers ───────────────────────────────────────

export interface ContentTypeInfo {
  type: string;
  label: string;
  color: string;
  bg: string;
}

const CONTENT_TYPES: Record<string, ContentTypeInfo> = {
  "regulatory": { type: "regulatory", label: "Regulatory", color: "var(--accent)", bg: "var(--accent-bg)" },
  "tool-spotlight": { type: "tool-spotlight", label: "Tool Spotlight", color: "var(--accent)", bg: "var(--accent-bg)" },
  "use-case": { type: "use-case", label: "Use Case", color: "var(--green)", bg: "var(--green-bg)" },
  "community-thread": { type: "community-thread", label: "Community", color: "var(--purple)", bg: "var(--purple-bg)" },
  "prompt-pattern": { type: "prompt-pattern", label: "Prompt Pattern", color: "var(--cyan)", bg: "var(--cyan-bg)" },
  "opinion": { type: "opinion", label: "Opinion", color: "var(--amber)", bg: "var(--amber-bg)" },
  "vendor-watch": { type: "vendor-watch", label: "Vendor Watch", color: "var(--red)", bg: "var(--red-bg)" },
};

export function getContentTypeInfo(type: string): ContentTypeInfo {
  return CONTENT_TYPES[type] || CONTENT_TYPES["regulatory"];
}

export function getAllContentTypes(): ContentTypeInfo[] {
  return Object.values(CONTENT_TYPES).filter((ct) => ct.type !== "regulatory");
}

// ── Date helpers ───────────────────────────────────────────────

export function relativeDate(dateStr: string): string {
  const now = new Date();
  const then = new Date(dateStr);
  const days = Math.floor((now.getTime() - then.getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "1d ago";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function formatMonthLabel(key: string): string {
  const [year, month] = key.split("-");
  const d = new Date(Number(year), Number(month) - 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
