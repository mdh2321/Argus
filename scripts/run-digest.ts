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
  const { runDigestIngest } = await import("../src/lib/digest-pipeline/ingest");

  const args = process.argv.slice(2);
  const cached = args.includes("--cached");
  const dryRun = args.includes("--dry-run");
  const skipSynthesis = args.includes("--no-synthesis");
  const jurisdictionsArg = args.find((a) => a.startsWith("--jurisdictions="));
  const jurisdictions = jurisdictionsArg
    ? jurisdictionsArg.slice("--jurisdictions=".length).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const weekArg = args.find((a) => a.startsWith("--week="));
  const referenceDate = weekArg ? weekArg.slice("--week=".length).trim() : undefined;

  try {
    const result = await runDigestIngest({ cached, dryRun, skipSynthesis, jurisdictions, referenceDate });
    console.log("\n[run-digest] Result:", JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error("[run-digest] FAILED:", err);
    process.exit(1);
  }
})();
