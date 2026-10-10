"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { ExternalLink, FileText, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { SidePanel } from "@/components/shared/side-panel";
import { locatePassage, type PassageRequest } from "@/lib/evidence-passage";
import type { SourceDocument } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export const OPEN_EVIDENCE = "argus:open-evidence";
export function openEvidence(request: PassageRequest) {
  window.dispatchEvent(new CustomEvent<PassageRequest>(OPEN_EVIDENCE, { detail: request }));
}
const fetcher = async (url: string): Promise<{ document: SourceDocument }> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("The attached source could not be loaded.");
  return response.json();
};

export function EvidencePanel() {
  const [request, setRequest] = useState<PassageRequest | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handler = (event: Event) => { setRequest((event as CustomEvent<PassageRequest>).detail); setOpen(true); };
    window.addEventListener(OPEN_EVIDENCE, handler);
    return () => window.removeEventListener(OPEN_EVIDENCE, handler);
  }, []);
  const { data, isLoading, error, mutate } = useSWR(request?.documentId ? `/api/source-documents/${encodeURIComponent(request.documentId)}` : null, fetcher, { revalidateOnFocus: false });
  useEffect(() => { if (open && request?.documentId) void mutate(); }, [open, request, mutate]);
  return <SidePanel open={open} onClose={() => setOpen(false)} title="Evidence, in context" description="Read the source without leaving your place.">
    {request && <>
      {request.claim && <details className="evidence-claim mb-5 border-b border-border pb-5"><summary className="cursor-pointer"><span className="page-kicker">The claim you’re checking</span><p className="summary-preview mt-3 line-clamp-2 text-[15px] leading-relaxed text-fg-2">{request.claim}</p></summary><p className="mt-3 text-[16px] leading-relaxed text-fg">{request.claim}</p></details>}
      {isLoading ? <p role="status" className="py-12 text-fg-3">Opening source text…</p> : error ? <div role="alert" className="rounded-xl bg-red-bg p-5"><p className="text-red-text">The attached source could not be loaded.</p><button type="button" className="argus-secondary mt-4" onClick={() => void mutate()}>Retry</button><SourceLink url={request.sourceUrl} /></div> : data?.document ? <PassageReader key={`${JSON.stringify(request)}:${data.document.contentHash || data.document.updatedAt}`} doc={data.document} request={request} /> : <div className="quiet-card p-6"><FileText className="mb-3 text-fg-3" /><h3 className="text-[18px]">Source text unavailable</h3><p className="mt-3 text-[15px] leading-relaxed text-fg-3">{request.sectionRef ? `Reference: ${request.sectionRef}. ` : ""}This citation has no attached document to read. The passage cannot be verified here.</p>{request.quote && <blockquote className="mt-5 border-l-2 border-border-hover pl-4 text-[16px] italic text-fg-2">{request.quote}<span className="mt-2 block text-[12px] not-italic text-fg-3">Quoted in the analysis; not checked against source text.</span></blockquote>}<SourceLink url={request.sourceUrl} /></div>}
    </>}
  </SidePanel>;
}

function SourceLink({ url }: { url?: string | null }) {
  return url && /^https?:\/\//i.test(url) ? <a href={url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 text-[14px] text-accent-text">Open original source<ExternalLink size={14} /></a> : null;
}

function PassageReader({ doc, request }: { doc: SourceDocument; request: PassageRequest }) {
  const text = doc.fullText ?? "";
  const match = useMemo(() => locatePassage(text, request), [text, request]);
  const [start, setStart] = useState(() => Math.max(0, (match?.start ?? 0) - 700));
  const [query, setQuery] = useState("");
  const [searchAt, setSearchAt] = useState<number | null>(null);
  const [searchMessage, setSearchMessage] = useState("");
  const markRef = useRef<HTMLElement>(null);
  const end = Math.min(text.length, Math.max(start + 9000, (match?.end ?? 0) > start && (match?.start ?? 0) < start + 9000 ? match!.end + 700 : 0));
  const selected = searchAt !== null ? { start: searchAt, end: searchAt + query.length } : match;
  const inView = selected && selected.start >= start && selected.start < end;
  useEffect(() => { markRef.current?.scrollIntoView({ block: "center", behavior: "instant" }); }, [start, searchAt]);
  function search(next = false) {
    if (!query.trim()) return;
    const at = text.toLowerCase().indexOf(query.toLowerCase(), next && searchAt !== null ? searchAt + 1 : 0);
    if (at < 0) { setSearchMessage(next ? "No more matches. Search again from the beginning." : "No matching text in this source."); return; }
    setSearchAt(at); setStart(Math.max(0, at - 700)); setSearchMessage("Match found in the attached text.");
  }
  const requestedPassage = !!(request.quote || request.sectionRef || request.quoteStart != null);
  return <>
    <div className="mb-5"><p className="page-kicker">{doc.role === "primary_text" ? "Primary instrument" : "Supporting source"}</p><h3 className="mt-2 text-[24px] leading-tight tracking-[-.02em]">{doc.name}</h3><p className="mt-3 text-[13px] text-fg-3">{doc.retrievedAt ? `Retrieved ${formatDate(doc.retrievedAt)}` : "Retrieval date not recorded"}{doc.contentHash ? ` · Snapshot ${doc.contentHash.slice(0,8)}` : ""}</p><SourceLink url={doc.sourceUrl || request.sourceUrl} /></div>
    {request.sectionRef && <p className="mb-3 text-[14px] text-fg-2">Reference: {request.sectionRef}</p>}
    <div className={`mb-6 rounded-xl px-4 py-3 text-[13px] leading-relaxed ${match?.kind === "quote" ? "bg-green-bg text-green-text" : "bg-amber-bg text-amber-text"}`}>
      {match?.kind === "quote" ? "Exact passage located in the attached text." : match?.kind === "section" ? "Referenced section located. Read the surrounding text for context; individual subsections and additional references need checking." : requestedPassage ? "The exact passage could not be located in this snapshot. Use search or open the original source." : "Reading the attached source text."} <span className="block mt-1">Current legal validity and commencement are separate checks.</span>
    </div>
    {!text ? <p className="py-6 text-fg-3">This source has no readable text attached.</p> : <>
      <form onSubmit={e => { e.preventDefault(); search(); }} className="mb-5 flex items-center gap-2"><label className="sr-only" htmlFor="evidence-search">Search source text</label><Search size={16} className="text-fg-3" /><input id="evidence-search" value={query} onChange={e => {setQuery(e.target.value);setSearchAt(null);setSearchMessage("");}} placeholder="Find a section or phrase" className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-[14px]" /><button className="argus-secondary" type="submit">Find</button>{searchAt !== null && <button className="argus-secondary" type="button" onClick={() => search(true)}>Next</button>}</form>
      {searchMessage && <p role="status" className="mb-4 text-[13px] text-fg-3">{searchMessage}</p>}
      <div className="rounded-2xl border border-border bg-bg px-6 py-7 evidence-text">{start > 0 && <p className="mb-4 font-sans text-[12px] text-fg-3">… preceding text omitted</p>}{inView ? <>{text.slice(start, selected.start)}<mark ref={markRef}>{text.slice(selected.start, Math.min(selected.end,end))}</mark>{text.slice(selected.end,end)}</> : text.slice(start,end)}{end < text.length && <p className="mt-4 font-sans text-[12px] text-fg-3">Text continues …</p>}</div>
      <div className="mt-5 flex items-center justify-between gap-3"><button className="argus-secondary" disabled={start === 0} onClick={() => {setStart(Math.max(0,start-8000));setSearchAt(null);}}><ChevronLeft size={14} />Earlier</button><span className="text-[12px] text-fg-3">{start.toLocaleString()}–{end.toLocaleString()} of {text.length.toLocaleString()} characters</span><button className="argus-secondary" disabled={end === text.length} onClick={() => {setStart(Math.max(start+1,end-700));setSearchAt(null);}}>Later<ChevronRight size={14} /></button></div>
    </>}
  </>;
}
