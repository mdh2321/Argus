import { TopNav } from "@/components/layout/top-nav";
import { GlobalSearch } from "@/components/shared/global-search";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <TopNav />
      <GlobalSearch />
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </>
  );
}
