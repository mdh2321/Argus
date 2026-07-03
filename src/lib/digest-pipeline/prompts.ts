import { SEARCH_TOPICS } from "./config";

export interface TrackerContextBlocks {
  entriesBlock: string;
  priorDigestBlock: string;
  priorWeekOf: string | null;
}

export function trackerContextString(ctx: TrackerContextBlocks): string {
  return `<tracker_context cache="true">
The user's Sentinel tracker currently monitors these items for Docusign (global technology company), sorted by most recently updated (max 100 shown):
${ctx.entriesBlock}
</tracker_context>

<prior_digest cache="true" week_of="${ctx.priorWeekOf ?? "n/a"}">
Last week's digest covered the following stories — treat material developments on these as DEVELOPING, not NEW:
${ctx.priorDigestBlock}
</prior_digest>`;
}

export interface JurisdictionPromptParams {
  jurisdictionName: string;
  jurisdictionCode: string;
  tier: "T1" | "T2";
  startDate: string;
  endDate: string;
  regulatorDomains: string[];
  courtDomains: string[];
  preSeededStories: string;
  searchHits: string;
}

export function jurisdictionExtractionPrompt(p: JurisdictionPromptParams): string {
  const topics = SEARCH_TOPICS.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const tierLabel =
    p.tier === "T1"
      ? "Tier 1 jurisdictions (AU, SG, JP)"
      : "Tier 2 jurisdictions (NZ, HK, IN, PH)";
  const budget = p.tier === "T1" ? 12 : 8;

  return `You are an expert legal researcher specializing in Asia-Pacific technology law, briefing the in-house legal team at Docusign (a global technology company) via the Sentinel legal intelligence platform.

You are given pre-fetched web search results for **${p.jurisdictionName}** (${p.jurisdictionCode}) covering legal and regulatory developments published between **${p.startDate}** and **${p.endDate}**.

**Pre-seeded stories already collected (RSS / forwarded):**
${p.preSeededStories || "(none)"}

**Search results to extract from:**
${p.searchHits}

You must identify stories across as many of these topics as the search results support. Topics:
${topics}

This jurisdiction is in ${tierLabel} with a search budget of ${budget} searches. Aim for ${p.tier === "T1" ? "≥ 3" : "≥ 1"} stories where material content exists.

**MANDATORY EXCLUSIONS — do NOT return stories about:**
- Criminal law (unless directly tied to tech regulation, e.g. computer misuse as part of a cyber law)
- Wills, trusts & estates
- Family law
- Purely domestic matters with no tech / commercial relevance

**Source priority (strict, in order):**
1. Regulator announcements (primary domains: ${p.regulatorDomains.join(", ")})
2. Court decisions (primary domains: ${p.courtDomains.join(", ")})
3. Legal publications
4. Law firm commentary

Read the full article text — do NOT rely on titles alone. Prioritise Docusign-relevant angles: eSignature regulations, contract formation rules, digital trust services, cross-border data flows, platform liability.

**Continuity awareness:** The <tracker_context> and <prior_digest> blocks tell you what is already tracked and what was covered last week. Material developments on already-tracked items are DEVELOPING (state what is NEW). Pure restatements — EXCLUDE.

**Focus on these event types:**
- Court decisions (superior and regulatory courts)
- Regulatory guidance (published guidelines, notices, enforcement announcements)
- Legislative updates (bills, acts, amendments, in any stage)
- Significant legal events (major enforcement, landmark consultations, treaty ratifications)

Return your findings as a JSON array. Each element must have exactly these fields:

[
  {
    "title": "Concise headline (max 12 words)",
    "url": "Full URL of the primary source",
    "source_name": "Publication or website name",
    "source_type": "regulator | court | publication | law_firm",
    "date": "YYYY-MM-DD",
    "summary": "3-4 sentences. Name the law/regulation/court, the regulator/court, what changed, who is affected. If DEVELOPING, state what is NEW since prior coverage.",
    "takeaways": ["Specific, verb-led action for Docusign's legal team", "..."],
    "urgency": "immediate_action | monitor_closely | awareness_only",
    "urgency_reason": "One sentence.",
    "categories": ["Privacy & Data Protection"],
    "entry_type_hint": "legislation | bill | regulation | binding-guidance | interpretive-guidance | enforcement | court-decision | consultation | policy",
    "lifecycle_stage": "Proposed | Consultation | Enacted | Effective | Enforced",
    "impact": "Low | Medium | High",
    "compliance_deadline": "YYYY-MM-DD or null",
    "regulator": "Name of primary regulator/court, or null",
    "background_context": "1-2 sentences of regulatory/judicial history.",
    "related_tracker_hint": "Quote a tracked item's short name verbatim, or null.",
    "topic_searched": "One of the 11 topics above",
    "jurisdiction_code": "${p.jurisdictionCode}"
  }
]

**Rules:**
- Return 3-7 stories, ranked by importance to Docusign's APAC legal team.
- Stories must come from at least 4 of the 11 topics if material content exists.
- Every URL must be real and present in the search results above.
- \`categories\` must be drawn ONLY from: Privacy & Data Protection | AI & Emerging Technology | Electronic Signatures & Transactions | Commercial & Contract Law | Consumer Protection | Corporations & Governance | Employment & Workplace | Anti-Corruption & Bribery | Modern Slavery & Supply Chain | Outsourcing & Procurement | Sustainability & ESG | Data Security & Breach Notification
- \`entry_type_hint\` drawn ONLY from: legislation | bill | regulation | binding-guidance | interpretive-guidance | enforcement | court-decision | consultation | policy. Use \`binding-guidance\` for regulator instruments issued under statutory authority that carry enforcement weight (e.g. APRA prudential standards, SEC interpretive releases). Use \`interpretive-guidance\` for advisory material that explains how a regulator views existing law without binding force. When in doubt, prefer \`interpretive-guidance\`.
- \`compliance_deadline\`: a date by which Docusign or its customers must take action to comply (e.g. effective date of a binding rule, last day of a consultation period, deadline for filing or registration). Court hearing dates, regulator review milestones, roadmap waypoints, and other "interesting future dates" do NOT belong here — leave null.
- \`impact\` measures effects flowing to Docusign through TWO pathways:
   (a) **Direct** — Docusign is itself legally obligated.
   (b) **Customer pass-through** — a rule binding Docusign's customers (commonly financial services, healthcare, government, legal) materially alters how they must use Docusign. Examples: financial-services outsourcing rules requiring banks to renegotiate vendor contracts; sectoral data-residency mandates forcing new product configurations; third-party risk regimes forcing customer-driven audits, certifications, or contract terms on Docusign.
   - **Low**: awareness only. Affects third parties or industry generally with no clear path of obligation to Docusign or its customers' use of Docusign.
   - **Medium**: review warranted. Applicable guidance, proposed or upcoming rules with a defined path to in-force, or pass-through effects that are plausible but speculative.
   - **High**: operational, product, commercial, or contractual changes required — a binding or imminent obligation through pathway (a) OR (b).
   - Coherence: if \`urgency\` is \`awareness_only\` or \`monitor_closely\` AND there is no \`compliance_deadline\`, \`impact\` is generally not High. Global significance ≠ Docusign impact.

Return ONLY the JSON array — no other text.`;
}

export interface SynthesisPromptParams {
  storiesJson: string;
}

export function synthesisPrompt(p: SynthesisPromptParams): string {
  return `You are a senior legal editor at a premium legal intelligence service, preparing a weekly digest for Docusign's in-house legal team via the Sentinel platform.

Stories collected this week:
${p.storiesJson}

Tasks:

1. **Deduplicate**: Return URLs to remove (same event under multiple jurisdictions → keep most comprehensive).

2. **Rank and cap**: Return the **top 10 stories** ranked by importance to Docusign's APAC legal work. Only exceed 10 (up to 15 max) if more than 10 stories independently meet BOTH \`impact:High\` AND \`urgency:immediate_action\`. If you exceed 10, set \`"exceptional_week": true\` and explain in the Executive Brief.

3. **Executive Brief** (~300 words): Senior partner's memo, first-person editorial voice. Lead with the single most important development and why it matters for Docusign. Cover 2-3 other significant stories thematically. End with forward-looking paragraph.

4. **Synopsis** (3-5 short bullets, ≤ 15 words each): Punchy teasers.

5. **Thematic Title** (≤ 60 chars): A magazine-style headline that captures the dominant theme of the week. Examples: "AI Regulation Takes Shape", "Privacy Reforms Sweep APAC", "Cybersecurity Obligations Expand". No "Weekly Digest" boilerplate, no dates.

6. **Slug**: Lowercase, kebab-case version of the thematic title. Example: "ai-regulation-takes-shape".

The digest is deliberately slim: executive brief + stories only. Forward-looking radar content lives on the platform's live Horizon page; cross-border and thematic synthesis lives in Signals. Do not produce radar, cross-border, scorecard, or region-insight sections.

Return JSON:
{
  "duplicate_urls_to_remove": [...],
  "title": "...",
  "slug": "...",
  "executive_brief": "...",
  "synopsis": [...],
  "ranked_urls": [...],
  "exceptional_week": false
}

Return ONLY the JSON.`;
}
