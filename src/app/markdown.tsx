/** Dependency-free markdown-ish renderer: headings, bold, inline code, code blocks, lists, links. */
export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  let code: string[] | null = null;

  const inline = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-[#EDE9E0] text-[13px]">$1</code>')
      .replace(
        /\[([^\]]+)\]\((https?:[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noreferrer" style="color:var(--accent);text-decoration:underline">$1</a>'
      );

  const flushList = () => {
    if (list.length) {
      out.push(
        <ul key={`ul-${out.length}`} className="list-disc pl-5 space-y-1 my-2">
          {list.map((li, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: inline(li) }} />
          ))}
        </ul>
      );
      list = [];
    }
  };

  for (const raw of lines) {
    if (raw.trim().startsWith("```")) {
      if (code) {
        out.push(
          <pre key={`pre-${out.length}`} className="bg-[#EDE9E0] rounded-lg p-3 my-2 text-[13px] overflow-x-auto">
            {code.join("\n")}
          </pre>
        );
        code = null;
      } else {
        flushList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(raw);
      continue;
    }
    const h = raw.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      flushList();
      out.push(
        <div
          key={`h-${out.length}`}
          className={`font-semibold ${h[1].length === 1 ? "text-base" : "text-sm"} mt-2`}
        >
          {h[2]}
        </div>
      );
      continue;
    }
    const li = raw.match(/^\s*[-*•]\s+(.*)/);
    if (li) {
      list.push(li[1]);
      continue;
    }
    flushList();
    if (raw.trim() === "") continue;
    out.push(
      <p key={`p-${out.length}`} className="my-1.5" dangerouslySetInnerHTML={{ __html: inline(raw) }} />
    );
  }
  flushList();
  if (code) {
    out.push(
      <pre key="pre-end" className="bg-[#EDE9E0] rounded-lg p-3 my-2 text-[13px] overflow-x-auto">
        {code.join("\n")}
      </pre>
    );
  }
  return <div className="leading-relaxed">{out}</div>;
}
