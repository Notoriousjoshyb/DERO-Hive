import { useMemo, useRef } from 'react';
import hljs from 'highlight.js/lib/common';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  language: string;
  themeClass: string; // e.g. "code-theme-vscode"
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
}

// hljs uses 'xml' for HTML; a few of our language ids need remapping.
function hljsLang(lang: string): string {
  if (lang === 'html') return 'xml';
  if (lang === 'plaintext') return 'plaintext';
  return lang;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// A lightweight syntax-highlighted code editor: a highlighted <pre> layer sits
// behind a transparent <textarea>, kept in perfect alignment (same font, size,
// padding, wrapping) with scroll synced. This gives VSCode-like colouring while
// keeping native textarea editing/undo/selection.
export function CodeEditor({ value, onChange, onKeyDown, language, themeClass, textareaRef }: Props): JSX.Element {
  const preRef = useRef<HTMLPreElement>(null);
  const innerTaRef = useRef<HTMLTextAreaElement>(null);
  const taRef = textareaRef ?? innerTaRef;

  const html = useMemo(() => {
    const lang = hljsLang(language);
    try {
      if (lang !== 'plaintext' && hljs.getLanguage(lang)) {
        return hljs.highlight(value, { language: lang, ignoreIllegals: true }).value;
      }
    } catch { /* fall through to escaped plain text */ }
    return escapeHtml(value);
  }, [value, language]);

  const syncScroll = (): void => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  // Shared metrics so the two layers line up exactly.
  const shared: React.CSSProperties = {
    margin: 0,
    padding: '12px 14px',
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: '13px',
    lineHeight: '1.55',
    tabSize: 2,
    whiteSpace: 'pre',
    overflowWrap: 'normal'
  };

  return (
    <div className={`relative flex-1 min-h-0 overflow-hidden code-editor ${themeClass}`}>
      <pre
        ref={preRef}
        aria-hidden
        className="hljs absolute inset-0 overflow-auto pointer-events-none"
        style={{ ...shared, background: 'transparent' }}
      >
        {/* trailing newline keeps the last line aligned with the textarea */}
        <code dangerouslySetInnerHTML={{ __html: html + '\n' }} />
      </pre>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={syncScroll}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className="absolute inset-0 w-full h-full resize-none outline-none overflow-auto code-editor-textarea"
        style={{ ...shared, color: 'transparent', background: 'transparent' }}
      />
    </div>
  );
}
