// Impact as a compact 3-bar glyph, coloured by level — magnitude at a glance
// without a badge or a leading dot that would indent a headline. High fills
// all three bars, Medium two, Low one. Shared by the story card and the feed.

export function ImpactGlyph({ impact }: { impact: string | null }) {
  const level = impact === "High" ? 3 : impact === "Medium" ? 2 : 1;
  const color =
    impact === "High" ? "var(--red)" : impact === "Medium" ? "var(--amber)" : "var(--green)";
  return (
    <span
      className="inline-flex items-end gap-[2px]"
      title={`${impact || "Low"} impact`}
      aria-label={`${impact || "Low"} impact`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full"
          style={{ height: `${5 + i * 3}px`, background: i < level ? color : "var(--border-hover)" }}
        />
      ))}
    </span>
  );
}
