# H2 — Sonnet 5 migration runbook (held for a tested pass)

Status: **not started** (decision Jul 2026 — hold for a one-site-at-a-time tested pass).
Everything below is on `claude-sonnet-4-6` today. H1 (defined-terms → Haiku) already shipped.

## Why held
- `summary-ai.ts` bounds thinking with `thinking: { type: "enabled", budget_tokens: 4096 }`. On Sonnet 5 `budget_tokens` is **removed (400)**; adaptive thinking has no fixed bound, so the 4-stage grounded pipeline can run for minutes and exceed the SDK's HTTP lifetime. This needs a **live long-run test** before shipping — control depth with `output_config: { effort: "low" | "medium" }` (and/or `thinking: { type: "disabled" }`) rather than a token budget.
- On Sonnet 5, **omitting `thinking` runs adaptive thinking by default** (4.6 ran thinking-off). Scheduled digest calls (signals/gap/scan) would silently gain thinking cost. Add `thinking: { type: "disabled" }` to preserve current behavior + cost, or budget `max_tokens` for the added thinking.
- No `temperature`/`top_p`/`top_k` anywhere → no sampling-param 400 risk.

## Per-site steps (each: swap ID, handle thinking, re-baseline `max_tokens`, spot-check output)
Model IDs (`claude-sonnet-4-6` → `claude-sonnet-5`, exact — no date suffix) in:

**Single-call sites (lower risk — add `thinking: { type: "disabled" }` to preserve thinking-off/cost):**
- `src/lib/signals-ai.ts` (max_tokens 4000) — scheduled
- `src/lib/gap-ai.ts` (4000) — scheduled-ish
- `src/lib/scan-ai.ts` (4000)
- `src/lib/capture-ai.ts` (3× 4000)
- `src/lib/comparator-ai.ts` (6000)
- `src/lib/share-ai.ts` (1000)
- `src/lib/topics.ts` (2500)
- `src/lib/ask-server.ts` (1500 / 6000 / 1500)
- `src/lib/digest-pipeline/config.ts` (MODEL constant)
- Route files that pass/select the model: `api/ask/route.ts`, `api/ask/stream/route.ts`,
  `api/digest/gap-suggestions/generate/route.ts`, `api/signals/generate/route.ts`,
  `api/library/briefings/generate/route.ts`, `api/tracker/entries/[id]/generate-artifact/route.ts`,
  `api/scan/route.ts`

**Multi-stage pipelines (higher risk — test long runs before shipping):**
- `src/lib/summary-ai.ts` — `callCached` (line ~364): replace `{ type: "enabled", budget_tokens: 4096 }`
  with `{ type: "adaptive" }` + `output_config: { effort: "low" }` (bound it), and add
  `{ type: "disabled" }` on the non-thinking (`thinking: false`) calls. **Live-test the full
  4-stage grounded analysis end-to-end for HTTP-timeout behavior.**
- `src/lib/knowledge-ai.ts` — already uses `{ type: "adaptive" }` (works on Sonnet 5); add
  `{ type: "disabled" }` on its non-thinking calls; re-baseline `max_tokens` (line ~254: 8000).
- `src/lib/summary-pipeline.ts` — `logAgentRun({ modelUsed: "claude-sonnet-4-6" })` label only.

## Verify per site
`assert response.model.startsWith("claude-sonnet-5")`; re-run `count_tokens` (new tokenizer ≈ +30%
tokens → re-baseline `max_tokens` and cost dashboard, which E1 now surfaces); confirm equal-or-better
output on a definitions/analysis spot-check.

## H3 — Batch API for bulk re-ground (one-off, not shipped)
Use the Batch API (50% off) for the one-off bulk re-grounding of top entries (~25) — NOT the
interactive "Run full analysis" button (that result is wanted the same session). This is an
operational job to run once, not a code change to land in the app.
