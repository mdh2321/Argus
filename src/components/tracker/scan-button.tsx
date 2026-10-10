"use client";

import { useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Radar, Loader2, Check, ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useProfile } from "@/hooks/use-profile";
import { triggerLandscapeScan } from "@/hooks/use-gap-suggestions";
import { JURISDICTIONS } from "@/lib/constants";

const EXAMPLES = [
  "E-signature laws across Asia",
  "Laws in Japan governing spam messages",
  "Recent AI regulation in Singapore",
];

export function ScanButton() {
  const { data: profileData } = useProfile();
  const profileJurisdictions = useMemo(
    () => profileData?.profile?.jurisdictionsOfInterest ?? [],
    [profileData]
  );

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);

  const trimmedQuery = query.trim();

  // Seed selection from profile when popover opens (or profile loads). We seed
  // each open so the picker reflects the user's current monitored set without
  // overwriting in-popover edits mid-session.
  useEffect(() => {
    if (open && selected.length === 0) {
      const seed =
        profileJurisdictions.length > 0
          ? profileJurisdictions
          : JURISDICTIONS.map((j) => j.code);
      setSelected(seed);
    }
  }, [open, profileJurisdictions, selected.length]);

  function toggle(code: string) {
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  function selectAll() {
    setSelected(JURISDICTIONS.map((j) => j.code));
  }

  function selectMonitored() {
    setSelected(profileJurisdictions);
  }

  function clearAll() {
    setSelected([]);
  }

  async function handleScan() {
    // A natural-language query takes precedence over the jurisdiction picker;
    // the server interprets which jurisdictions and topic it implies.
    const isNL = trimmedQuery.length > 0;
    if (!isNL && selected.length === 0) {
      toast.error("Describe what to scan for, or select a jurisdiction");
      return;
    }
    setScanning(true);
    const promise = triggerLandscapeScan(
      isNL ? { query: trimmedQuery } : { jurisdictions: selected }
    );
    toast.promise(promise, {
      loading: isNL
        ? "Interpreting and scanning…"
        : `Scanning ${selected.length} jurisdiction${selected.length === 1 ? "" : "s"}…`,
      success: (data) => {
        const failedCount = data.jurisdictionsFailed?.length ?? 0;
        const baseMsg =
          data.generated > 0
            ? `Found ${data.generated} suggestion${data.generated === 1 ? "" : "s"}`
            : "No new suggestions found";
        const scanned = data.jurisdictionsScanned?.length
          ? ` across ${data.jurisdictionsScanned.join(", ")}`
          : "";
        const message = failedCount > 0
          ? `${baseMsg}${scanned} (${failedCount} failed: ${data.jurisdictionsFailed.join(", ")})`
          : `${baseMsg}${scanned}`;
        return {
          message,
          description: (
            <span className="flex flex-col gap-1">
              {data.interpretation && (
                <span className="text-fg-3">{data.interpretation}</span>
              )}
              <Link
                href="/digest"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                Review in digest <ExternalLink className="h-3 w-3" />
              </Link>
            </span>
          ),
        };
      },
      error: (err) => err?.message || "Scan failed",
    });
    try {
      await promise;
      setOpen(false);
      setQuery("");
    } catch {
      // toast already surfaced the error
    } finally {
      setScanning(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-[14px] font-medium text-fg-2 transition-colors hover:border-border-hover hover:bg-hover hover:text-fg"
          title="Scan the regulatory landscape for missing entries"
        >
          {scanning ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Radar className="w-4 h-4" aria-hidden="true" />
          )}
          Scan
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 w-[340px] rounded-xl border border-border bg-surface p-4 shadow-xl"
        >
          <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-fg-3">
            <Radar className="h-3 w-3" />
            Landscape scan
          </div>
          <p className="mb-3 text-[12px] leading-relaxed text-fg-3">
            Search authoritative sources for laws, bills, regulations, or binding guidance
            missing from the tracker. Suggestions land in the review queue.
          </p>

          {/* Natural-language query — takes precedence over the picker below */}
          <div className="mb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-fg-3" />
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!scanning) void handleScan();
                  }
                }}
                rows={2}
                placeholder="Describe what to scan for — e.g. e-signature laws in Asia"
                className="w-full resize-none rounded-lg border border-border bg-bg py-2 pl-9 pr-3 text-[13px] text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-border-accent"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setQuery(ex)}
                  className="rounded-full border border-border bg-bg px-2 py-0.5 text-[11px] text-fg-3 transition-colors hover:border-border-hover hover:text-fg-2"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          <div className="my-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-fg-3">
            <span className="h-px flex-1 bg-border" />
            or pick jurisdictions
            <span className="h-px flex-1 bg-border" />
          </div>

          <div
            className={`mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-wide text-fg-3 transition-opacity ${
              trimmedQuery ? "opacity-40" : ""
            }`}
          >
            <span>Jurisdictions ({selected.length})</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="hover:text-accent transition-colors"
              >
                All
              </button>
              {profileJurisdictions.length > 0 && (
                <button
                  type="button"
                  onClick={selectMonitored}
                  className="hover:text-accent transition-colors"
                >
                  Monitored
                </button>
              )}
              <button
                type="button"
                onClick={clearAll}
                className="hover:text-accent transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          <ul className={`mb-4 grid grid-cols-2 gap-1 transition-opacity ${trimmedQuery ? "opacity-40" : ""}`}>
            {JURISDICTIONS.map((j) => {
              const checked = selected.includes(j.code);
              return (
                <li key={j.code}>
                  <button
                    type="button"
                    onClick={() => toggle(j.code)}
                    className={`w-full flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[12px] transition-colors ${
                      checked
                        ? "border-accent/40 bg-accent-bg text-fg"
                        : "border-border text-fg-2 hover:bg-hover"
                    }`}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${
                        checked ? "border-accent bg-accent" : "border-border"
                      }`}
                    >
                      {checked && <Check className="h-2.5 w-2.5 text-bg" />}
                    </span>
                    <span className="text-base leading-none">{j.flag}</span>
                    <span className="font-mono text-[11px]">{j.code}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-[11px] text-fg-2 transition-colors hover:bg-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleScan}
              disabled={scanning || (!trimmedQuery && selected.length === 0)}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-mono text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {scanning ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : trimmedQuery ? (
                <Search className="h-3 w-3" />
              ) : (
                <Radar className="h-3 w-3" />
              )}
              {scanning ? "Scanning…" : trimmedQuery ? "Search" : "Run scan"}
            </button>
          </div>
          <Popover.Arrow className="fill-border" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
