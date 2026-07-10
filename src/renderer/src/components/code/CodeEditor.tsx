import { useMemo, useRef } from 'react';
import hljs from 'highlight.js/lib/common';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  language: string;
  themeClass: string; // e.g. "code-theme-vscode"
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  showLineNumbers?: boolean;
  showLineGuides?: boolean;
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
export function CodeEditor({ value, onChange, onKeyDown, language, themeClass, textareaRef, showLineNumbers = true, showLineGuides = true }: Props): JSX.Element {
  const preRef = useRef<HTMLPreElement>(null);
  const innerTaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
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

  const lineNumbers = useMemo(() => {
    const count = value.split('\n').length || 1;
    return Array.from({ length: count }, (_, i) => i + 1).join('\n');
  }, [value]);

  const syncScroll = (): void => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
    if (gutterRef.current && taRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
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

  const gutterWidth = showLineNumbers ? 48 : 0;

  return (
    <div className={`relative flex-1 min-h-0 overflow-hidden code-editor ${themeClass}`}>
      {showLineGuides && showLineNumbers && (
        <div
          className="code-editor-lines absolute top-0 bottom-0 pointer-events-none"
          style={{ left: gutterWidth, right: 0 }}
        />
      )}
      {showLineNumbers && (
        <div
          ref={gutterRef}
          aria-hidden
          className="code-editor-gutter absolute left-0 top-0 bottom-0 w-12 overflow-hidden pointer-events-none"
        >
          <div style={{ ...shared, padding: '12px 8px 12px 0' }}>{lineNumbers}</div>
        </div>
      )}
      <pre
        ref={preRef}
        aria-hidden
        className="hljs absolute top-0 bottom-0 overflow-auto pointer-events-none"
        style={{ ...shared, left: gutterWidth, right: 0, background: 'transparent' }}
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
        className="absolute top-0 bottom-0 resize-none outline-none overflow-auto code-editor-textarea"
        style={{ ...shared, left: gutterWidth, right: 0, color: 'transparent', background: 'transparent' }}
      />
    </div>
  );
}
