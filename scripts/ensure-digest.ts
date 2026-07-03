// Daily reconciler: make sure this week's digest exists and has been delivered.
// Idempotent — safe to run every morning via launchd. A fixed Monday cron fails
// silently if the Mac is asleep; this self-heals the next time it runs.
//
// Usage: npm run digest:ensure [-- --force] [-- --redeliver]
//   --force      re-run the pipeline even if this week's issue exists
//   --redeliver  re-send telegram even if already marked delivered
//
// Must run with --conditions=react-server (the npm script does) so that
// `server-only` imports in src/lib resolve to the empty stub.

// Load env from .env.local before importing anything that needs it.
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

(async () => {
  const { db, sqlite } = await import("../src/db");
  const { digestIssues } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { resolveWeekRange, runDigestIngest } = await import("../src/lib/digest-pipeline/ingest");
  const { deliverDigest, sendFailureAlert } = await import("../src/lib/digest-pipeline/deliver");

  // One-shot guarded migration (matches the project's direct-ALTER pattern).
  try {
    sqlite.exec("ALTER TABLE digest_issues ADD COLUMN delivered_at TEXT");
    console.log("[ensure] added digest_issues.delivered_at");
  } catch {
    // column already exists
  }

  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const redeliver = args.includes("--redeliver");

  const { weekStart } = resolveWeekRange();
  console.log(`[ensure] ${new Date().toISOString()} — checking week of ${weekStart}`);

  let issue = db
    .select({ id: digestIssues.id, status: digestIssues.status, deliveredAt: digestIssues.deliveredAt })
    .from(digestIssues)
    .where(eq(digestIssues.weekStart, weekStart))
    .limit(1)
    .all()[0];

  // 1. Generate if missing (or forced).
  if (!issue || issue.status !== "published" || force) {
    console.log(issue ? "[ensure] re-running pipeline" : "[ensure] no issue for this week — running pipeline");
    try {
      const result = await runDigestIngest({});
      console.log(`[ensure] pipeline done: ${result.storyCount} stories, $${result.costUsd.toFixed(2)}, ${(result.durationMs / 1000).toFixed(0)}s`);
    } catch (err) {
      const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.error("[ensure] pipeline FAILED:", msg);
      await sendFailureAlert(`Pipeline error for week of ${weekStart}:\n${msg}`);
      process.exit(1);
    }
    issue = db
      .select({ id: digestIssues.id, status: digestIssues.status, deliveredAt: digestIssues.deliveredAt })
      .from(digestIssues)
      .where(eq(digestIssues.weekStart, weekStart))
      .limit(1)
      .all()[0];
    if (!issue) {
      await sendFailureAlert(`Pipeline reported success but no issue row exists for week of ${weekStart}.`);
      process.exit(1);
    }
  } else {
    console.log(`[ensure] issue ${issue.id} already published`);
  }

  // 2. Deliver if not yet delivered (or forced).
  if (issue.deliveredAt && !redeliver) {
    console.log(`[ensure] already delivered at ${issue.deliveredAt} — nothing to do`);
    process.exit(0);
  }

  const delivery = await deliverDigest(issue.id);
  console.log(`[ensure] delivery: telegram=${delivery.telegram}`);
  for (const e of delivery.errors) console.error(`[ensure] delivery error: ${e}`);

  if (delivery.telegram === "sent") {
    db.update(digestIssues)
      .set({ deliveredAt: new Date().toISOString() })
      .where(eq(digestIssues.id, issue.id))
      .run();

    // 3. Refresh dashboard signals off the fresh week's data. Runs only on a
    // successful first delivery, so cadence (and cost — one Sonnet call) is
    // weekly. Non-fatal: the digest is already out.
    try {
      const { generateSignals } = await import("../src/lib/signals-ai");
      const { logAgentRun } = await import("../src/lib/agent-runs");
      const created = await generateSignals();
      await logAgentRun({
        workflow: "signals",
        modelUsed: "claude-sonnet-4-6",
        entriesCreated: created.length,
      });
      console.log(`[ensure] signals refreshed: ${created.length} active`);
    } catch (err) {
      console.error("[ensure] signals refresh FAILED (non-fatal):", err instanceof Error ? err.message : String(err));
    }

    // 4. Bounded source-freshness pass: re-fetch the sources of the 5
    // high-impact entries whose docs were checked longest ago (round-robin
    // via lastUrlCheck, which every refresh bumps). Weekly cadence, no AI
    // cost — just fetches. Non-fatal.
    try {
      const { entries, sourceDocuments } = await import("../src/db/schema");
      const { refreshSourcesForEntry } = await import("../src/lib/source-refresher");
      const { gte, and: andOp, sql } = await import("drizzle-orm");
      const candidates = db
        .select({
          entryId: sourceDocuments.entryId,
          oldestCheck: sql<string>`min(coalesce(${sourceDocuments.lastUrlCheck}, ''))`,
        })
        .from(sourceDocuments)
        .innerJoin(entries, eq(sourceDocuments.entryId, entries.id))
        .where(andOp(eq(entries.archived, false), gte(entries.impactScore, 4)))
        .groupBy(sourceDocuments.entryId)
        .orderBy(sql`min(coalesce(${sourceDocuments.lastUrlCheck}, ''))`)
        .limit(5)
        .all();
      for (const c of candidates) {
        const outcomes = await refreshSourcesForEntry(c.entryId);
        const changed = outcomes.filter((o) => o.status === "changed").length;
        console.log(`[ensure] source refresh ${c.entryId}: ${outcomes.length} docs, ${changed} changed`);
      }
    } catch (err) {
      console.error("[ensure] source refresh FAILED (non-fatal):", err instanceof Error ? err.message : String(err));
    }
    process.exit(0);
  }

  if (delivery.telegram === "failed") {
    await sendFailureAlert(
      `Digest for week of ${weekStart} generated but delivery failed:\n${delivery.errors.join("\n")}`
    );
    process.exit(1);
  }

  // Skipped (channel unconfigured) — leave undelivered so tomorrow retries.
  console.warn("[ensure] telegram not configured — set TELEGRAM_BOT_TOKEN and DIGEST_TELEGRAM_CHAT_ID");
  process.exit(0);
})();
