# Sentinel

Personal legal intelligence platform for in-house APJ legal work: discover and track legal/regulatory updates, and review and understand legislation across APJ jurisdictions. Single-user, runs locally on this Mac.

Impact framing throughout: effects on Docusign directly, or on Docusign via customer pass-through (e.g. bank outsourcing rules) — never "general news significance".

## Modules

| Surface | What it does |
|---|---|
| **Dashboard** (`/`) | Top stories, signals, deadlines, stats — the daily landing view |
| **Ask** (`/ask`) | Streamed, cited Q&A over the tracker/digest corpus (FTS5 retrieval, multi-turn) |
| **Tracker** (`/tracker`) | The canonical corpus: laws, bills, regulations, binding guidance per jurisdiction, with impact lenses, sources, deadlines, relationships. `/tracker/horizon` = timeline view |
| **Digest** (`/digest`) | Weekly AI-generated issue (Exa search → pipeline → executive brief + stories), delivered via Telegram |
| **Library** (`/library`) | Topic dossiers and the Shelf (pinned/saved artifacts) |
| **Methodology** (`/methodology`) | How scoring/grounding works |
| **Settings** (`/settings`) | Profile, jurisdictions, API health |

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

See `.env.example`: `ANTHROPIC_API_KEY`, `EXA_API_KEY`, `TELEGRAM_BOT_TOKEN`, `DIGEST_TELEGRAM_CHAT_ID`, `SENTINEL_BASE_URL`.

## Known tech debt

- `src/app/(shell)/(tracker)/tracker/[id]/page.tsx` is ~2,400 lines. Deliberately not refactored (works, heavily used); split only when a change forces it.

## Planning docs

Active plans live in the parent directory (`~/Projects/sentinel/`): `SENTINEL_BUILD_BRIEF.md` (north star), `PRODUCTION_READY_PLAN_JUL2026.md`, `DIGEST_UPGRADE_PLAN_JUL2026.md`, `INDUSTRY_INTEL_SPINOFF_PLAN.md`. Superseded plans are in `~/Projects/sentinel/archive/`.
