"use client";

import { SubNav } from "@/components/layout/sub-nav";

// June 2026 library rebuild: exactly two kinds of things. Topics — the
// living wiki, compiled and regenerated, never hand-authored. Shelf — frozen
// artifacts stamped with their generation date, never auto-updated.
const tabs = [
  { href: "/library", label: "Topics", exact: true },
  { href: "/library/shelf", label: "Shelf" },
  { href: "/library/threads", label: "Threads" },
];

export default function LibraryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SubNav links={tabs} />
      {children}
    </>
  );
}
