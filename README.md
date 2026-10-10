# Argus

> Renamed from **Sentinel** (July 2026) — after Argus Panoptes, the all-seeing watchman. Infra artifacts keep the old name: the DB file (`data/sentinel.db`), env vars (`SENTINEL_BASE_URL`), the launchd label (`com.sentinel.digest`), backup dir, and the `~/Projects/sentinel/` folder.

Personal legal intelligence platform for in-house APJ legal work: discover and track legal/regulatory updates, and review and understand legislation across APJ jurisdictions. Single-user, runs locally on this Mac.

Impact framing throughout: effects on Docusign directly, or on Docusign via customer pass-through (e.g. bank outsourcing rules) — never "general news significance".

## Modules

| Surface | What it does |
|---|---|
| **Dashboard** (`/`) | Priority reviews, upcoming dates and concise radar signals; full context in side panels |
| **Ask** (`/ask`) | Streamed, cited Q&A over the tracker/digest corpus (FTS5 retrieval, multi-turn) |
| **Tracker** (`/tracker`) | The canonical corpus: laws, bills, regulations, and binding guidance per jurisdiction, with impact lenses, sources, deadlines, relationships, and an Upcoming lifecycle view |
| **Digest** (`/digest`) | Weekly AI-generated issue (Exa search → pipeline → executive brief + stories), delivered via Telegram |
| **Threads** (`/saved`) | Searchable briefings, saved answers and starred stories; links to topic dossiers and conversations |
| **Automations** (`/automations`) | Existing background workflows, run history and costs |
| **Settings** (`/settings`) | Profile, jurisdictions, API health |

Tracker entries open in the tabbed reading view: Overview, Analysis, Timeline, Instrument and Sources. Footnotes open the shared evidence panel; exact quotes are checked against the attached snapshot before highlighting. Ambiguous or missing pinpoints are identified explicitly. The entry menu’s **Edit & manage record** opens the complete existing editor at `/tracker/[id]/legacy`; `/v2` bookmarks still work. The list retains search, filters, ordering, density and return position.

Compare, Methodology and Matters pages are retired from navigation and redirect to active screens. Their APIs and stored content remain intact. Existing `/library/shelf` and `/digest/saved` bookmarks redirect to Threads.

## Stack

Next.js 16 (App Router), TypeScript, Tailwind v4, Drizzle ORM + better-sqlite3, SWR, Anthropic SDK, Exa. No auth, no deployment — `localhost:3000` only.

**Next.js 16 has breaking changes** — read `node_modules/next/dist/docs/` before writing code (see `AGENTS.md`).

## Running

```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev                  # http://localhost:3000
```

## Database

SQLite at `data/sentinel.db` (schema in `src/db/schema.ts`, Drizzle). Inspect directly:

```bash
sqlite3 data/sentinel.db '.tables'
```

The DB is the product — it is git-ignored and backed up nightly to `~/Backups/sentinel/` (7-day weekday rotation, launchd).

Schema changes have historically been applied via direct `ALTER TABLE` (drizzle-kit push had issues with existing DB state).

## Digest automation

A launchd job (`~/Library/LaunchAgents/com.sentinel.digest.plist`, label `com.sentinel.digest`) runs `npm run digest:ensure` daily at 07:30 and at login. The reconciler is idempotent: it generates the current week's issue if missing and delivers it via Telegram if not yet delivered.

- Log: `~/Library/Logs/sentinel-digest.log`
- Flags: `npm run digest:ensure -- --force` (re-run pipeline even if issue exists), `-- --redeliver` (re-send even if delivered)
- Manual pipeline run: `npm run digest` (or `npm run digest:dry`)

Delivery is **Telegram-only** by decision (July 2026); there is no email path.

## Scripts

`scripts/` holds live entry points only: `run-digest.ts`, `ensure-digest.ts`, `refresh-sources.ts`. Finished one-time migrations/seeds live in `scripts/archive/` (excluded from tsconfig).

## Env vars

See `.env.example`: `ANTHROPIC_API_KEY`, `EXA_API_KEY`, `TELEGRAM_BOT_TOKEN`, `DIGEST_TELEGRAM_CHAT_ID`, `SENTINEL_BASE_URL`. Optional: `TELEGRAM_WEBHOOK_SECRET` — verifies inbound Telegram `track <n>` replies (D3); set it and register the webhook with the same secret via Telegram's `setWebhook`.

## Known tech debt

- `src/app/(shell)/(tracker)/tracker/[id]/page.tsx` is ~2,400 lines. Deliberately not refactored (works, heavily used); split only when a change forces it.
- **Gap vs. miss detection (G1, decision Jul 2026 — keep both).** Two "did we miss anything" mechanisms are retained deliberately: `gap-ai.ts` / `scan-ai.ts` write `gap_suggestions` proposing *untracked instruments to add* (digest- and scan-sourced), while `digest-pipeline/miss-detection.ts` finds *tracked milestones the digest didn't cover* (milestone-grounded, surfaced via the digest result + Telegram alert). They overlap in intent but not output, so they are not merged. The speculative digest-driven gap path (`generateGapSuggestions()`) is manual-only (the "generate" button), so it does not auto-duplicate miss-detection. Revisit retiring `gap_suggestions`' digest path after a few digest cycles once miss-detection recall is trusted; do not delete `gap_suggestions` blind — `scan-button.tsx` and `use-gap-suggestions.ts` depend on it.
- **Library claims layer is frozen (G2, decision Jul 2026).** `knowledgeClaims` / grounding-ratio / per-claim dispute bookkeeping is kept but not extended — for a single operator, per-claim dispute flags are meta-work. Briefings and topic dossiers (the parts actually used) stay. No new work on the claims layer.

## Planning docs

Active plans live in the parent directory (`~/Projects/sentinel/`): `SENTINEL_BUILD_BRIEF.md` (north star), `PRODUCTION_READY_PLAN_JUL2026.md`, `DIGEST_UPGRADE_PLAN_JUL2026.md`, `INDUSTRY_INTEL_SPINOFF_PLAN.md`. Superseded plans are in `~/Projects/sentinel/archive/`.
