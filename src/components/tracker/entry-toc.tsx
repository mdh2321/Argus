"use client";

import { useEffect, useState } from "react";

interface SectionAnchor {
  id: string;
  label: string;
}

// Sticky right-rail table of contents for the tracker entry page. Tracks
// which section is currently visible via IntersectionObserver, highlights it,
// and lets the user jump by clicking. Hidden below xl breakpoint — there's
// no room for it on narrower viewports.
export function EntryTOC({ sections }: { sections: SectionAnchor[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (sections.length === 0) return;

    // Track each section's "intersection ratio" so we can pick the most
    // visible one on every observer fire. A naive "first entry that is
    // intersecting" misses the case where two sections are both visible —
    // we want the one closest to the top of the viewport, not whichever
    // happened to fire first.
    const ratios = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(entry.target.id, entry.intersectionRatio);
        }

        // Pick the section with the highest visible ratio. Tie-break by
        // document order (the section list is already in order).
        let bestId: string | null = null;
        let bestRatio = 0;
        for (const { id } of sections) {
          const r = ratios.get(id) ?? 0;
          if (r > bestRatio) {
            bestRatio = r;
            bestId = id;
          }
        }
        if (bestId) setActiveId(bestId);
      },
      {
        // Treat the area under the sticky top nav (h-14 = 56px) and a
        // bit of breathing room as "above the fold" — so a section is
        // considered active once its top crosses ~80px from the viewport
        // top. Negative bottom margin makes the activation feel less
        // jumpy when scrolling fast.
        rootMargin: "-80px 0px -60% 0px",
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    for (const { id } of sections) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [sections]);

  if (sections.length < 2) return null;

  return (
    <nav aria-label="On this page">
      <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3 mb-2 pl-3">
        On this page
      </div>
      <ul className="space-y-px border-l border-border">
        {sections.map((s) => {
          const active = s.id === activeId;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={(e) => {
                  // Smooth-scroll to the section. The native anchor jump
                  // is jarring inside a long doc; this keeps the user
                  // oriented.
                  e.preventDefault();
                  const el = document.getElementById(s.id);
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "start" });
                    history.replaceState(null, "", `#${s.id}`);
                    setActiveId(s.id);
                  }
                }}
                className={`block -ml-px border-l-2 pl-3 py-1 text-[12px] transition-colors ${
                  active
                    ? "border-accent text-fg"
                    : "border-transparent text-fg-3 hover:text-fg-2"
                }`}
              >
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
