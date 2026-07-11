# Entry & Source Model Plan — July 2026

Restructures the tracker around the **anchor/satellite** model and makes sources
first-class evidence, incorporating learnings from the Legora platform review
(July 2026). Companion analysis lives in the conversation that produced this
plan; the conceptual rules are restated here so the doc stands alone.

## The model in five rules

1. **Entry = dossier, source = evidence.** An entry is a monitored subject plus
   our analysis and lifecycle state. A source is retrieved text that grounds the
   analysis. Never merge them; link them.
2. **Anchors are the compliance surface.** Principal legislation, regulations,
   and binding guidance carry full analysis. Everything else — amending bills,
   consultations, enforcement, court decisions, interpretive guidance — is a
   satellite inside an anchor's file.
3. **Satellites carry deltas, not duplicate analysis.** "What this changes /
   clarifies", never a second account of the underlying obligations.
4. **New law = one entry across its whole lifecycle** (proposed → bill →
   in_force). **Amendment = temporary entry** that folds into the anchor on
   commencement and invalidates the anchor's grounding.
5. **Interpretive guidance is both satellite and source** — it appears on the
   anchor's timeline AND feeds the anchor's grounding pool.

## Ask citation policy (decision)

**Cite both, hierarchically — entry-first with an evidence pin.**

- The **entry** is the navigational citation: it carries jurisdiction, status,
  impact context, and is where the user lands.
- The **source document passage** is the evidentiary pin nested beneath it:
  docId + sectionRef + verbatim quote, for "where does the law itself say this".
- **Never a bare source-doc citation** — a doc without its dossier strips the
  context that makes the citation useful.
- Which level leads depends on what grounded the claim: analysis-field match →
  entry citation alone; instrument-text match → entry citation + pin.

This mirrors `EntryClaimCitation` (which already has `sourceDocumentId` +
`sectionRef`) — Ask adopts the same shape rather than inventing a new one.

---

## Phase 1 — Source layer foundations

**1.1 Source document roles.** Add `role: 'primary_text' | 'supporting'` to
`source_documents`. Each instrument entry designates exactly one primary text
(the instrument itself); everything else is supporting. Backfill: prefer
`official_legislation` authority + URL tier `primary_legislation`; else leave
`supporting` for manual promotion. UI: distinct treatment in the Sources panel
("The instrument" section above "Supporting materials").

**1.2 Exact-quote anchored citations** (leapfrogs Legora's known weakness —
their citations stop at source level). When the summary pipeline emits a claim
with `groundingType: "direct_quote"`, require a verbatim `quote` string.
Verify by exact string match against the stored `fullText`; store
`quoteStart`/`quoteEnd` offsets and `quoteVerified: boolean` on
`EntryClaimCitation`. Match → "Quote verified" badge + guaranteed pinpoint
highlight (replaces the best-effort `findSectionOffset` scroll). No match →
downgrade grounding to `paraphrase`. Existing claims keep the heuristic path.

**1.3 Compilation/version history.** New table `source_document_versions`
(docId, contentHash, fullText, retrievedAt, trigger). When `source-refresher`
detects a hash change, snapshot the outgoing text as a version instead of
silently overwriting. Entry page gains a small version timeline on the primary
text ("Compilation as retrieved 14 Mar 2026 → 12 Jul 2026"). Answers "what did
this say when we assessed it".

## Phase 2 — Anchor/satellite tracker restructure

**2.1 Formalize the split.** Derive `isAnchor` from type: anchors =
`legislation`, `regulation`, `binding-guidance`, plus new-law `bill`s with no
`amends` relationship (anchors in embryo). Satellites = `amending-act`, bills
that amend, `consultation`, `enforcement`, `court-decision`,
`interpretive-guidance`, `policy`. Validation: a satellite must link to an
anchor via `amends` / `interprets` / `implements` / `subordinate_to`; creation
flow prompts for the anchor.

**2.2 Anchor-centric tracker list.** Default list shows anchors only, each row
carrying a satellite activity line ("1 bill in flight · guidance updated 3d
ago") derived from linked satellites. Flat all-entries view remains as a
toggle. Satellites render inside the anchor page: timeline + a "Satellites"
rail grouped by relationship kind.

**2.3 Delta analysis for satellites.** Satellite entries stop generating the
full analysis field set. New delta fields: `whatItChanges` (amendments),
`whatItClarifies` (guidance), `outcome` (enforcement/court). Pipeline prompts
per relationship kind. Existing satellite entries keep old fields read-only
until regenerated.

**2.4 Amendment commencement wiring** (completes the existing auto-archive).
When an `amends` satellite reaches `in_force`: (a) refresh the anchor's
primary text via `source-refresher`; (b) snapshot the old compilation (1.3);
(c) flag the anchor's analysis stale — new trust badge "Analysis predates
amendment" via `computeTrustBadges`; (d) surface a one-click "Re-ground
analysis" action that reruns the summary pipeline against the new compilation.

**2.5 Guidance grounding pool.** Source documents of `interprets` satellites
join the anchor's grounding pool (tier `regulator`) for the summary pipeline
and artifact generators. Guidance doc update → anchor gets "Needs review"
badge. This is the concrete payoff of rule 5.

## Phase 3 — Ask citations: entry-first with evidence pins

**3.1 Citation shape.** Extend `AskArgusCitation` with optional
`pin: { sourceDocumentId, sectionRef, quote, quoteVerified }`. Renderer shows
the entry chip; pinned citations expand to the exact passage inline (popover)
with a link that deep-links to the tracker page and fires the existing
reveal-source event.

**3.2 Retrieval over instrument text.** Today `buildCorpus` folds only the
first 2,000 chars of docs into the entry body. Chunk `primary_text` documents
into their own retrievable passages (reuse `retrieveChunks`, currently
scoped-Ask only) so global Ask can ground claims in the actual instrument text
and emit pins. Passage hits attribute to their parent entry (policy above).

**3.3 Realm & tier transparency** (Legora's three-realm pattern). Label each
citation with its realm — `Analysis` (entry fields), `Instrument text`
(primary-text passage), `Web` — plus the existing tier chip. Order citations
authority-first: primary legislation before regulator before commentary when
multiple sources support the same claim.

**3.4 Copy-as-citation.** One-click copy of `formalCitation` + pinpoint
("Privacy Act 1988 (Cth) s 13G") on Ask citations and tracker claim chips.

## Phase 4 — Instrument registry (later, unlocked by 1–3)

**4.1 Canonical instruments table** keyed by formal citation; entries link to
an instrument; source docs dedupe across entries; reverse index ("cited by N
entries / matters / pinned answers").

**4.2 Registry-aware fetchers.** Specialize `source-fetcher` per official
register (legislation.gov.au, EUR-Lex, SSO SG, e-Legislation HK) to extract
compilation metadata. Provenance chip: "Official register · compilation as at
14 Mar 2026".

**4.3 Library Instruments surface.** Browsable registry: freshness, tier,
version history, dependent entries.

## Phase 5 — Comparator polish

Cell-level citations in the comparator grid (instrument × question), each cell
clicking through to the highlighted passage — the Tabular Review pattern.

---

## Sequencing & rationale

1 → 2 → 3 → 4 → 5. Phase 1 is small and everything hangs off it (roles feed
2.4/2.5/3.2; quote anchoring feeds 3.1). Phase 2 is the structural change.
Phase 3 delivers the visible Ask upgrade. Phase 4 is deferred until the
anchor model settles — the registry formalizes identity that phases 1–2
already approximate via primary texts. Phase 5 is opportunistic.

## Open questions for sign-off — RESOLVED 2026-07-11

1. **2.2** — anchor-centric list: **opt-in toggle first** (flat list stays
   default; "Anchors" toggle in the list controls sets `?anchored=1`).
2. **2.3** — `impactScore`: **in-flight amendments keep it; guidance rolls up**
   (whatItClarifies regeneration nulls the satellite's own score).
3. **2.1** — data audit run: 7 orphan satellites found (NZ Privacy Amendment
   Act, MAS AI consultation, 3 soft-law guidance frameworks, 2 amendment-named
   bills w/ no `amends` link). Decision: **soft-warn + grandfather** — validation
   never blocks; standalone soft-law guidance is an allowed anchorless category
   (`ANCHORLESS_OK_TYPES`).

## Implementation status — Phases 1–3 SHIPPED 2026-07-11

All of Phases 1, 2, and 3 implemented; `tsc --noEmit` clean; `next build`
passes. Migration: `scripts/migrate-entry-source-model.ts` (idempotent).

Key modules added: `src/lib/anchor-model.ts` (classification + satellite
roll-up), `src/lib/source-roles.ts`. Schema: `source_documents.role`,
`source_document_versions`, `entries.{what_it_changes,what_it_clarifies,outcome}`.
Citations: `EntryClaimCitation.quote*`, `AskArgusCitation.{realm,tier,pin,
formalCitation}`.

**Known follow-ups / deferred (not in this pass):**
- No relationship-editor UI yet, so the orphan-satellite soft banner tells the
  user what's needed but there's no in-app control to add the `amends`/`interprets`
  link (relationships are seeded by migration/AI). Creation flow is AI-extraction,
  so "prompt for anchor" is realised as the post-creation soft banner.
- §2.5 guidance grounding pool is wired into the **summary pipeline**; the
  on-demand **artifact generators** don't yet pull the guidance pool.
- §3.2 pins are attached by server-side passage retrieval + verbatim quote
  location (entry-first, pin second), not by per-claim model attribution — the
  answer JSON schema was left unchanged.
- Deep-report's secondary citation card renders without the new realm/pin/copy
  chrome (the streaming `SourceRow` path has it).
- Phases 4 (instrument registry) and 5 (comparator cell citations) deferred per
  the sequencing plan.
