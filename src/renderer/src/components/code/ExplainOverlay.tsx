import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  code: string;
  path: string;
  language: string;
  onClose: () => void;
}

export function ExplainOverlay({ code, path, language, onClose }: Props): JSX.Element {
  const [explanation, setExplanation] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const explanationRef = useRef<HTMLDivElement>(null);

  const explainCode = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const langMap: Record<string, string> = {
        ts: 'TypeScript', tsx: 'TypeScript/React', js: 'JavaScript', jsx: 'JavaScript/React',
        py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', cpp: 'C++', c: 'C',
        rb: 'Ruby', swift: 'Swift', kt: 'Kotlin', sql: 'SQL', sh: 'shell', bash: 'bash',
        json: 'JSON', yaml: 'YAML', toml: 'TOML', md: 'Markdown', html: 'HTML', css: 'CSS',
      };
      const langName = langMap[language] || language;
      const prompt = `Explain this ${langName} code concisely in plain English. Cover what it does, why it does it that way, and any notable patterns or potential issues. Format in short paragraphs, not bullet points. If anything is unclear or looks like a bug, say so.\n\n\`\`\`${language}\n${code.slice(0, 2000)}\n\`\`\``;
      // Get current conversation context from the chat view
      const messages = (window as unknown as { __hive_messages?: Array<{ role: string; content: string }> }).__hive_messages ?? [];
      const systemPrompt = `You are an expert code explanation assistant. Keep explanations concise but complete. When code has potential bugs or issues, mention them directly.`;
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            ...(messages.length > 0 ? messages : []),
            { role: 'user', content: prompt }
          ],
          systemPrompt,
          stream: false,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { message?: { content?: string } };
      setExplanation(data?.message?.content || 'No explanation returned.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [code, language]);

  useEffect(() => { void explainCode(); }, [explainCode]);

  // Scroll to top on new content
  useEffect(() => { explanationRef.current?.scrollTo(0, 0); }, [explanation]);

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#1e1e1e] border-l border-[#3f3f3f]" style={{ top: 0 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#3f3f3f] flex-shrink-0">
        <span className="text-[11px] text-[#d4d4d4]">💡 Explain: {path.split(/[/\\\\]/).pop()}</span>
        <button
          onClick={onClose}
          className="ml-auto text-[#6a6a6a] hover:text-[#d4d4d4] text-xs px-2 py-0.5 rounded border border-[#3f3f3f] hover:border-[#5f5f5f]"
        >Close</button>
      </div>
      {/* Code preview */}
      <div className="flex-shrink-0 max-h-32 overflow-auto px-4 py-2 border-b border-[#2f2f2f]">
        <pre className="text-[10px] text-[#6a6a6a] font-mono whitespace-pre-wrap">{code.split('\n').slice(0, 15).join('\n')}{code.split('\n').length > 15 ? '\n…' : ''}</pre>
      </div>
      {/* Explanation */}
      <div ref={explanationRef} className="flex-1 overflow-auto px-4 py-3">
        {loading && (
          <div className="flex items-center gap-2 text-[11px] text-[#6a6a6a]">
            <span className="animate-spin">◌</span> Analysing code…
          </div>
        )}
        {error && (
          <div className="text-[11px] text-red-400">Error: {error}</div>
        )}
        {explanation && !loading && (
          <div className="text-[12px] text-[#d4d4d4] leading-relaxed space-y-2">
            {explanation.split('\n').filter(Boolean).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
