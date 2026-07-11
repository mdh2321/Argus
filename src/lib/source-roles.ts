import type { SourceDocumentRole } from "./types";
import { inferSourceTier } from "./source-tiers";

// Anchor/satellite evidence roles (plan §1.1). A "primary text" is the
// instrument itself — the ground-truth legal text — and an entry has at most
// one. Everything else is "supporting".
export const PRIMARY_TEXT: SourceDocumentRole = "primary_text";
export const SUPPORTING: SourceDocumentRole = "supporting";

/**
 * Whether a doc looks like the instrument's own text: official-legislation
 * authority, or a primary-legislation URL tier, with usable extracted text.
 * The same heuristic the backfill uses, so runtime and migration agree.
 */
export function isPrimaryTextCandidate(doc: {
  sourceUrl?: string | null;
  fullText?: string | null;
  sourceAuthority?: string | null;
}): boolean {
  if (!doc.fullText || doc.fullText.length < 200) return false;
  if (doc.sourceAuthority === "official_legislation") return true;
  if (doc.sourceUrl && inferSourceTier(doc.sourceUrl).tier === "primary_legislation") return true;
  return false;
}
