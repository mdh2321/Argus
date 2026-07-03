"use client";

import { SubNav } from "@/components/layout/sub-nav";

const tabs = [
  { href: "/digest", label: "Latest", exact: true },
  { href: "/digest/issues", label: "Archive" },
  { href: "/digest/saved", label: "Saved" },
];

export default function DigestLayout({
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
