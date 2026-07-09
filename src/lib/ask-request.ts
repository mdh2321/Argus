import type { AskScope } from "@/lib/ask-types";

const SCOPE_KINDS: AskScope["kind"][] = ["entry", "story", "knowledge", "signal", "matter"];
const MAX_SCOPES = 8;

/** Validate one untrusted scope object into an AskScope, or null. */
function parseOne(raw: unknown): AskScope | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!SCOPE_KINDS.includes(o.kind as AskScope["kind"])) return null;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  return {
    kind: o.kind as AskScope["kind"],
    id: o.id.trim(),
    label: typeof o.label === "string" ? o.label : undefined,
  };
}

/**
 * Validate the untrusted `scopes` (array) / `scope` (single, legacy) fields
 * from a request body into a deduped AskScope[]. Empty array means "ask across
 * the whole corpus".
 */
export function parseScopes(body: Record<string, unknown> | null | undefined): AskScope[] {
  if (!body) return [];
  const raw = Array.isArray(body.scopes)
    ? body.scopes
    : body.scope !== undefined
      ? [body.scope]
      : [];

  const seen = new Set<string>();
  const out: AskScope[] = [];
  for (const r of raw) {
    const scope = parseOne(r);
    if (!scope) continue;
    const key = `${scope.kind}:${scope.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(scope);
    if (out.length >= MAX_SCOPES) break;
  }
  return out;
}

/** True when the working set is non-empty and made up entirely of news stories. */
export function isNewsConversation(scopes: AskScope[]): boolean {
  return scopes.length > 0 && scopes.every((s) => s.kind === "story");
}
