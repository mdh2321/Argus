import "server-only";

import Database from "better-sqlite3";
import type { CorpusItem } from "@/lib/ask-corpus";

export interface ScoredItem {
  item: CorpusItem;
  score: number;
}

// FTS5 treats these as query operators/special characters. We tokenize the
// user query into bare alphanumeric terms and rebuild a safe MATCH expression,
// so none of these ever reach the parser as syntax.
const FTS_TOKEN = /[a-z0-9]+/g;

function toMatchExpression(query: string, extraTerms: string[] = []): string {
  const raw = `${query} ${extraTerms.join(" ")}`;
  const tokens = [...new Set((raw.toLowerCase().match(FTS_TOKEN) || []).filter((t) => t.length > 1))];
  if (tokens.length === 0) return "";
  // Prefix-match each term (OR) so "breach" matches "breaches",
  // "notification" matches "notifications", etc. This is the cheap stemming
  // win the audit asked for — real relevance without embeddings.
  return tokens.map((t) => `"${t}"*`).join(" OR ");
}

/** Result of a corpus retrieval, including which path produced it — the
 *  impact fallback used to swap in silently; the trace surfaces it now. */
export interface CorpusRetrieval {
  matches: ScoredItem[];
  mode: "fts" | "impact_fallback";
  /** Total lexical hits before the limit was applied. */
  totalHits: number;
}

/**
 * Rank the corpus against a query using SQLite FTS5 + BM25, then blend in a
 * light impact/urgency boost so high-stakes records surface among close
 * lexical matches. Builds a throwaway in-memory index per call — the corpus is
 * small (~150 records) so this is fast and avoids any sync/staleness problems
 * a persistent FTS table would introduce.
 *
 * Replaces the previous hand-rolled keyword scoring (30-word stopword list,
 * substring matching). Returns BM25-ranked matches, or an impact/urgency
 * fallback when the query yields no lexical hits.
 */
export function retrieveCorpus(
  corpus: CorpusItem[],
  query: string,
  limit: number,
  extraTerms: string[] = []
): CorpusRetrieval {
  const match = toMatchExpression(query, extraTerms);
  if (!match || corpus.length === 0) {
    return { matches: fallbackMatches(corpus).slice(0, limit), mode: "impact_fallback", totalHits: 0 };
  }

  const fts = new Database(":memory:");
  try {
    fts.exec(
      `CREATE VIRTUAL TABLE docs USING fts5(
         item_id UNINDEXED, title, body, meta,
         tokenize = 'porter unicode61'
       );`
    );

    const insert = fts.prepare("INSERT INTO docs(item_id, title, body, meta) VALUES (?, ?, ?, ?)");
    const insertAll = fts.transaction((rows: CorpusItem[]) => {
      for (const r of rows) insert.run(r.id, r.title, r.body, r.meta);
    });
    insertAll(corpus);

    // bm25() returns a negative score where lower (more negative) is a better
    // match. Column weights favour title, then meta, then body.
    const rows = fts
      .prepare(
        `SELECT item_id AS id, bm25(docs, 10.0, 3.0, 5.0) AS rank
           FROM docs
          WHERE docs MATCH ?
          ORDER BY rank`
      )
      .all(match) as { id: string; rank: number }[];

    if (rows.length === 0) {
      return { matches: fallbackMatches(corpus).slice(0, limit), mode: "impact_fallback", totalHits: 0 };
    }

    const byId = new Map(corpus.map((c) => [c.id, c]));
    const scored: ScoredItem[] = [];
    for (const row of rows) {
      const item = byId.get(row.id);
      if (!item) continue;
      // Convert BM25 (lower = better) into a positive relevance, then nudge by
      // impact + urgency so a high-impact near-match can edge out a lexical tie.
      const relevance = -row.rank;
      const score = relevance + 0.2 * (item.impactRank + item.urgencyRank);
      scored.push({ item, score });
    }

    scored.sort((a, b) => b.score - a.score || b.item.date.localeCompare(a.item.date));
    return { matches: scored.slice(0, limit), mode: "fts", totalHits: scored.length };
  } finally {
    fts.close();
  }
}

export interface TextChunk {
  id: string;
  index: number;
  text: string;
}

/**
 * Rank passages of a single source document against a query (the scoped-Ask
 * path). Same throwaway in-memory FTS5 + BM25 approach as `retrieveCorpus`,
 * but over chunks of one document so the answer can be grounded in the most
 * relevant provisions without blowing the context window on a long Act.
 *
 * Falls back to the leading passages (intro / definitions, usually the most
 * useful) when the query yields no lexical hits.
 */
export function retrieveChunks(chunks: TextChunk[], query: string, limit: number): TextChunk[] {
  const match = toMatchExpression(query);
  if (!match || chunks.length === 0) return chunks.slice(0, limit);

  const fts = new Database(":memory:");
  try {
    fts.exec(
      `CREATE VIRTUAL TABLE passages USING fts5(
         chunk_id UNINDEXED, text, tokenize = 'porter unicode61'
       );`
    );
    const insert = fts.prepare("INSERT INTO passages(chunk_id, text) VALUES (?, ?)");
    const insertAll = fts.transaction((rows: TextChunk[]) => {
      for (const r of rows) insert.run(r.id, r.text);
    });
    insertAll(chunks);

    const rows = fts
      .prepare(`SELECT chunk_id AS id FROM passages WHERE passages MATCH ? ORDER BY bm25(passages)`)
      .all(match) as { id: string }[];

    if (rows.length === 0) return chunks.slice(0, limit);

    const byId = new Map(chunks.map((c) => [c.id, c]));
    const out: TextChunk[] = [];
    for (const row of rows) {
      const c = byId.get(row.id);
      if (c) out.push(c);
      if (out.length >= limit) break;
    }
    return out;
  } finally {
    fts.close();
  }
}

/** Impact/urgency ranking used when a query has no lexical matches (or is empty). */
export function fallbackMatches(corpus: CorpusItem[]): ScoredItem[] {
  return [...corpus]
    .map((item) => ({ item, score: item.impactRank + item.urgencyRank }))
    .sort((a, b) => b.score - a.score || b.item.date.localeCompare(a.item.date));
}
