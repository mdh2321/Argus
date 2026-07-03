// Seed the Topics wiki (June 2026 refinement plan B4 + C1) with the starter
// set — topics matching real question traffic, not 50 speculative pages.
// Idempotent: skips topics whose slug already exists.
//
// Usage: npx tsx scripts/seed-topics.ts [--generate]
//   --generate  also compile each topic's explainer (one model call each)

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

// Terms are matched (case-insensitive; substring only for terms >= 5 chars)
// against entry category+tags, story categories+tags, signal categories.
const STARTER_TOPICS: { title: string; slug: string; terms: string[] }[] = [
  {
    title: "Privacy Reform",
    slug: "privacy-reform",
    terms: ["Privacy & Data Protection", "privacy", "data protection", "data-protection", "personal data"],
  },
  {
    title: "AI Governance",
    slug: "ai-governance",
    terms: ["AI & Emerging Technology", "AI governance", "artificial intelligence", "responsible AI", "AI labeling", "deepfakes", "synthetic content"],
  },
  {
    title: "E-Signature Validity & Digital Trust",
    slug: "e-signature-validity",
    terms: ["Electronic Signatures & Transactions", "eSignature", "electronic-signatures", "electronic signature", "electronic-transactions", "electronic-documents", "digital identity", "UNCITRAL"],
  },
  {
    title: "Data Breach & Cybersecurity Obligations",
    slug: "data-breach-cybersecurity",
    terms: ["Data Security & Breach Notification", "Cybersecurity & Data Breach Notification", "cybersecurity", "breach-notification", "breach notification", "incident reporting"],
  },
  {
    title: "Cross-Border Data Transfers",
    slug: "cross-border-data-transfers",
    terms: ["cross-border transfer", "cross-border", "data transfer", "data residency", "data localisation", "data localization"],
  },
  {
    title: "Financial Services & Outsourcing Rules",
    slug: "financial-services-outsourcing",
    terms: ["Outsourcing & Procurement", "financial services", "outsourcing", "APRA", "prudential", "third-party risk"],
  },
];

(async () => {
  const generate = process.argv.includes("--generate");

  const { db } = await import("../src/db");
  const { knowledgeItems } = await import("../src/db/schema");
  const { eq, and } = await import("drizzle-orm");
  const { generateId, now, toJsonString } = await import("../src/lib/utils");

  for (const def of STARTER_TOPICS) {
    const existing = db
      .select({ id: knowledgeItems.id })
      .from(knowledgeItems)
      .where(and(eq(knowledgeItems.itemType, "topic"), eq(knowledgeItems.slug, def.slug)))
      .get();

    if (existing) {
      console.log(`= ${def.title} (exists)`);
      continue;
    }

    const ts = now();
    await db.insert(knowledgeItems).values({
      id: generateId(),
      slug: def.slug,
      title: def.title,
      itemType: "topic",
      jurisdiction: null,
      category: null,
      content: "",
      confidence: "medium",
      groundedIn: "entries",
      topicTerms: toJsonString(def.terms),
      staleAfterDays: 30,
      autoRefresh: true,
      status: "stale",
      createdAt: ts,
      updatedAt: ts,
    });
    console.log(`+ ${def.title}`);
  }

  if (generate) {
    // Imported lazily so plain seeding never needs an API key. topics.ts is
    // tagged server-only, which tsx tolerates via the react-server condition
    // being absent — if this ever breaks, run generation through the API.
    const { regenerateTopicExplainer } = await import("../src/lib/topics");
    for (const def of STARTER_TOPICS) {
      process.stdout.write(`compiling ${def.slug}… `);
      const result = await regenerateTopicExplainer(def.slug);
      console.log(`${result.content.length} chars, ${result.membership.entries.length} laws, ${result.membership.stories.length} stories`);
    }
  }

  console.log("Done.");
})();
