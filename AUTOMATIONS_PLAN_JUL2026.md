# Automations Plan — July 2026

**Status: agreed direction, NOT yet implemented.** Drafted 2026-07-15 after a
first-principles review of the `/automations` surface. Build order and scope
below; the visible layer is deliberately deferred until the workers have run
for a few weeks.

---

## 1. Philosophy

Argus's pitch is *"you don't have to keep checking."* Automations are the
standing workers that make that literally true. The system is **not**
self-improving AI — it is a **self-correcting database**: a fixed model doing
the checking, the human doing the verifying. Each cycle compares the corpus
against reality (regulator sites, the calendar, the news) and every
discrepancy becomes a proposal. Entropy gets reconciled away; nothing
self-modifies.

### Admission test — an automation earns a spot only if it passes all three

1. **It works on a trigger a human is bad at** — time passing, an external
   document changing, a threshold approaching. If the trigger is "the user
   wants it right now," it's a *tool* and lives on its home surface (Scan on
   Tracker, Ask, Compare). Tools never appear on the automations page.
2. **It does work the user would otherwise have to remember to do.**
3. **Its output lands in an existing decision surface** — review queue,
   dashboard, digest, Telegram. An automation never gets its own inbox. If a
   proposed automation needs a new surface to display results, it's bloat.

### Platform-wide rules

- **Automations propose, humans commit.** Nothing auto-edits an entry,
  auto-adds an instrument, or auto-approves a change. The review queue is the
  trust mechanism.
- **Cheap deterministic checks run often; model calls run only when the cheap
  check finds something.** (Sentry is pure SQL; Watchdog only calls a model
  on a changed hash.)
- **Cadences are fixed**, not user-configurable (exception: standing-scan
  tempo, weekly/monthly). Per worker: an on/off toggle and a quiet "Run now"
  only.
- **"Run now" must execute the same code path as the scheduled run** and log
  to `update_runs` identically; it refuses to start while a run of the same
  workflow is in flight; on completion it links to where output landed
  ("4 proposals → Review queue").

---

## 2. The roster — six workers, three cadences

| Cadence | Worker | Job | Output lands in |
|---|---|---|---|
| Daily | **Source Watchdog** | Re-fetch source docs, diff, propose entry updates | Review queue |
| Daily | **Deadline Sentry** | Watch typed deadlines, alert at rungs | Dashboard + Telegram |
| Weekly | **Digest** (exists) | Assemble + deliver the weekly issue | Digest + Telegram |
| Weekly | **Radar Signals** (exists, chained) | Re-score landscape vs profile after digest delivery | Dashboard radar |
| Weekly | **Gap Suggestions** (to chain) | Read fresh digest, propose untracked instruments | Review queue |
| Monthly | **Standing Scans** (deferred) | Re-run a saved landscape-scan query | Review queue |

One-sentence story: *every day Argus re-checks your sources and deadlines;
every week it builds your digest, refreshes your radar, and proposes what's
missing; every month it re-runs your watches — and everything it finds waits
for your approval.*

### Rejected (so they stay rejected)

- Generic if-this-then-that rule builder — every useful rule in this domain
  is already one of the six.
- Standing Ask / scheduled reports — overlaps digest + standing scans;
  produces unread output.
- Auto-approve of watchdog changes, even "low-risk" ones.
- A separate Matter watch — matter-linked entries simply get priority in the
  Watchdog's daily budget (an ordering clause, not a worker).
- Stale-analysis refresher as its own worker — folded into Watchdog (source
  changed → summary stale → propose re-analysis).

---

## 3. Build now (invisible layer — needed under any future design)

### Phase 1 — Honest run logging

`update_runs` currently logs successes only, so a dead schedule looks
identical to a quiet one.

- Add columns (direct-ALTER pattern, as with prior migrations):
  `status TEXT` ('ok' | 'failed' | 'running'), `error TEXT`,
  `duration_ms INTEGER`.
- `logAgentRun` (src/lib/agent-runs.ts) gains failure logging; every workflow
  call site records failures, not just successes.
- The 'running' state doubles as the mutex for "Run now" and as the
  in-flight indicator (today in-flight only tracks `entries.summaryStatus`).

### Phase 2 — Deadline Sentry (smallest piece; ~a day)

Pure SQL over the `deadlines` table (id, entry_id, date, label, urgency,
kind) joined to unarchived entries. No model call ever.

- **Rungs by kind:**
  - `compliance` → 30 / 14 / 7 / 1 days
  - `process` → 14 / 7 days
  - `watch` → dashboard only, no push
  - Legacy rows with empty `kind` (206 at time of writing): treat as `watch`
    until typed.
- **Alert memory:** new table `deadline_alerts` (deadline_id, rung, sent_at)
  so each deadline speaks at most once per rung. Only new schema it needs.
- **Backward look:** a deadline that *passed* while its entry status didn't
  change (e.g. commencement date passed, entry still "pending") → proposed
  status change into the review queue. Date-driven trigger feeding the same
  correction loop as the Watchdog.
- **Delivery:** Telegram via the existing digest channel
  (`TELEGRAM_BOT_TOKEN` / `DIGEST_TELEGRAM_CHAT_ID`); include linked matter
  name when the entry is matter-linked. Plus a dashboard "Approaching" strip
  (small; can trail the backend).
- Runs daily from the launchd reconciler (see Phase 5).

### Phase 3 — Source Watchdog (the flagship)

The mechanical loop already exists in `src/lib/source-refresher.ts`:
fetch+extract → hash compare → on change: snapshot outgoing text to
`source_document_versions`, persist, log `entry_changes`
(`fieldChanged: "source_text"`, `changedBy: "ai"`), bump `interprets` anchors
(Needs Review badge), re-extract defined terms. Dead URLs record
`fetch_status`/`fetch_error` and bump `lastUrlCheck`.

What the Watchdog adds:

1. **Daily priority budget** (~25 docs/day): matter-linked entries first,
   then `impactScore`, then longest-unchecked (`lastUrlCheck` round-robin
   already provides rotation). Corpus cycles every 1–2 weeks; most
   consequential instruments checked most often. Replaces the 5-entry pass
   currently tucked inside `ensure-digest.ts`.
2. **The reasoning step (the actual gap today).** On changed hash, one model
   call receives the old snapshot + new text and produces:
   - a plain-language delta ("s.13 penalty S$1M → S$2M; new s.13A on
     AI-generated signatures; commencement confirmed 1 Oct 2026"), and
   - concrete proposed field updates (status, key dates, penalties, flag
     summary stale) written as `entry_changes` proposals for the review
     queue's existing approve/dismiss (A1) flow.
3. **Link-rot escalation:** a URL failing N (=3) consecutive checks surfaces
   as a review-queue housekeeping item instead of dying silently in
   `fetch_error`.

Pipeline: fetch → hash → *(only if changed)* → model diff → proposals →
review queue. Most days: zero model calls.

### Phase 4 — Chain gap suggestions into the reconciler

In `scripts/ensure-digest.ts`, after the signals refresh (step 3), call
`generateGapSuggestions()` + `logAgentRun({ workflow: "gap", ... })`,
non-fatal, same pattern as signals. Natural cadence: after each digest
publishes. Suggestions are waiting in the review queue Monday morning.

### Phase 5 — Scheduling

The weekly digest reconciler stays as-is (launchd `com.sentinel.digest`,
daily 07:30, idempotent/self-healing). Watchdog + Sentry need a **daily**
runner: either a second script on the same launchd job (preferred: one
`scripts/daily-agents.ts` invoked by the existing 07:30 job before the digest
check) or a separate LaunchAgent. Same env-loading pattern
(`.env.local` parse) and failure alerts via `sendFailureAlert`.

---

## 4. Deferred (visible layer — decide after ~2–3 weeks of real runs)

Waiting will not settle these from the armchair; watching the workers run
will. Revisit once there's real run history including real failures.

- **Automations page redesign.** Leave `/automations` alone meanwhile.
  Target shape when revisited: a **fleet/health view**, organized by the
  daily/weekly/monthly rhythm (not a flat card grid), showing per worker:
  last run, outcome ("3 changes proposed"), next expected run, failures in
  red (needs Phase 1), spend. The weekly chain rendered as a chain
  (Digest → Signals → Gaps), not three cards. Controls per worker: on/off,
  quiet "Run now", nothing else. No triggers as the page's purpose — all
  primary triggers live on home surfaces. Consider renaming ("Automations"
  promises Zapier-style rules): "Activity" / "System" / "Agents".
- **Standing scans.** Most speculative item; only one needing new
  interaction design. Shape: a "Watch this" button on landscape-scan results
  turns the NL query into a recurring scan (weekly/monthly — the only
  cadence choice in the system) filing findings into the review queue. The
  query is the rule; no builder. Decision point: after the interactive scan
  has been used a few times post-launch and re-running one is a felt need.
- **Cadence/config UI.** Nothing to configure until the defaults are proven
  wrong. Digest day/time preference belongs in Settings if ever.
- **ActivityPopover vs page dedup.** Both consume `/api/activity` and render
  the same data. Once the page becomes a health view they differentiate;
  if the page is instead killed, the popover is the single activity/spend
  surface.

---

## 5. Open questions for implementation time

- Watchdog daily budget size and rung values are guesses — tune from the
  first weeks of proposals (signal vs noise in the review queue).
- Model for the Watchdog diff call (cheap + long-context; the diff summary
  is constrained by the two texts, so a smaller model may suffice — decide
  against current price/quality at build time).
- Whether Sentry alerts should also produce a standing "deadlines this
  fortnight" block in the weekly digest.
- Whether the completion toast in `ActivityPopover` should key off
  `update_runs.status='running'` (Phase 1) instead of `entries.summaryStatus`.

## 6. Context: what exists today (July 2026)

- `/automations` page: 4 cards (signals, gap, scan, digest) + spend bars +
  recent runs; only place triggering `signals/generate`; duplicates
  ActivityPopover data and in-context triggers (gap-nudge on Digest,
  scan-button on Tracker).
- True automation today: `scripts/ensure-digest.ts` via launchd
  `com.sentinel.digest` (daily 07:30) — digest generate+deliver → signals
  refresh → bounded 5-entry source-freshness pass. Failure alerts via
  Telegram only; invisible to the UI.
- `update_runs` has no status/error/duration; failures are unlogged.
- Attribution pattern to preserve/extend: `AgentBadge` stamps provenance on
  outputs where they live (radar, briefings, ask answers, summaries).
