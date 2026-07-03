"use client";

import { SubNav } from "@/components/layout/sub-nav";

const tabs = [
  { href: "/tracker", label: "Entries", exact: true },
  { href: "/tracker/horizon", label: "Horizon" },
  { href: "/tracker/new", label: "New" },
];

export default function TrackerLayout({
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
