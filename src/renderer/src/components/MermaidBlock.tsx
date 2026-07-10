import { useEffect, useRef, useState } from 'react';

// Lazily-loaded mermaid singleton — the library is ~1 MB, so it only loads
// the first time a conversation actually contains a diagram.
let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null;
function loadMermaid(): Promise<typeof import('mermaid')['default']> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
        fontFamily: 'var(--font-sans)'
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let renderSeq = 0;

// Renders a ```mermaid fence as an inline diagram. Invalid/incomplete source
// falls back to the raw code so nothing is ever lost.
export function MermaidBlock({ code }: { code: string }): JSX.Element {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadMermaid()
      .then(async (mermaid) => {
        const id = `mermaid-inline-${++renderSeq}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) setSvg(rendered);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          // mermaid.render leaves an orphaned error element in <body> on failure
          document.querySelectorAll('[id^="dmermaid-inline-"], [id^="mermaid-inline-"]').forEach((el) => {
            if (el.tagName !== 'svg' && !containerRef.current?.contains(el)) el.remove();
          });
        }
      });
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <div className="my-3 rounded-[10px] overflow-hidden border border-border bg-bg-code">
        <div className="px-3 py-1.5 bg-bg-sidebar/80 border-b border-border flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-fg-subtle font-mono font-medium">mermaid</span>
          <span className="text-[10px] text-warn">diagram failed to render</span>
        </div>
        <pre className="p-3 overflow-x-auto text-xs leading-relaxed"><code>{code}</code></pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-3 px-3 py-4 rounded-[10px] border border-border bg-bg-code text-xs text-fg-subtle text-center">
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-3 p-3 rounded-[10px] border border-border bg-bg-code overflow-x-auto flex justify-center [&_svg]:max-w-full [&_svg]:h-auto"
      // Safe: mermaid output with securityLevel "strict" (labels/links sanitised)
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
