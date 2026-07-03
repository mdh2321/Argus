"use client";

// Minimal markdown renderer for compiled topic explainers and frozen shelf
// artifacts. Handles exactly the dialect the generators emit — ### headings,
// bullets, bold, horizontal rules, GFM tables, paragraphs — without pulling
// in a markdown dependency.

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  // Unescape pipes the table serializer escaped, then split on bold spans.
  const unescaped = text.replace(/\\\|/g, "|");
  const parts = unescaped.split(/(\*\*[^*]+\*\*|_[^_]+_)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-${i}`} className="font-semibold text-fg">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
      return (
        <em key={`${keyPrefix}-${i}`} className="text-fg-3">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}

function splitRow(line: string): string[] {
  // Split on unescaped pipes, drop the leading/trailing empties from | a | b |.
  const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

const isTableRow = (line: string) => line.startsWith("|");
const isTableDivider = (line: string) => /^\|?[\s:|-]+\|?$/.test(line) && line.includes("-");

export function TopicMarkdown({ content }: { content: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={key++} className="space-y-2">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2 text-[14px] leading-relaxed text-fg-2">
            <span className="mt-0.5 text-accent">&bull;</span>
            <span>{renderInline(b, `b${key}-${i}`)}</span>
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // GFM table: header row + divider + body rows.
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1].trim())) {
      flushBullets();
      const header = splitRow(line);
      const bodyRows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j].trim())) {
        bodyRows.push(splitRow(lines[j].trim()));
        j++;
      }
      blocks.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border">
                {header.map((h, hi) => (
                  <th
                    key={hi}
                    className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.04em] text-fg-3"
                  >
                    {renderInline(h, `th${key}-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} className="border-b border-border/60 align-top">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={`px-3 py-2.5 leading-relaxed ${ci === 0 ? "font-medium text-fg whitespace-nowrap" : "text-fg-2"}`}
                    >
                      {renderInline(cell, `td${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      i = j - 1;
      continue;
    }

    if (line === "---") {
      flushBullets();
      continue;
    }
    if (line.startsWith("### ")) {
      flushBullets();
      blocks.push(
        <h3 key={key++} className="label-mono pt-2">
          {line.slice(4)}
        </h3>
      );
      continue;
    }
    if (line.startsWith("## ")) {
      flushBullets();
      blocks.push(
        <h2 key={key++} className="text-[15px] font-semibold text-fg pt-2">
          {line.slice(3)}
        </h2>
      );
      continue;
    }
    if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
      continue;
    }
    flushBullets();
    blocks.push(
      <p key={key++} className="text-[14px] leading-relaxed text-fg-2">
        {renderInline(line, `p${key}`)}
      </p>
    );
  }
  flushBullets();

  return <div className="space-y-3">{blocks}</div>;
}
