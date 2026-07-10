import { useEffect } from 'react';
import { useAppStore } from '../stores/app';
import { Message } from './Message';

export function MessageList(): JSX.Element {
  const messages = useAppStore((s) => s.currentMessages);
  const tools = useAppStore((s) => s.tools);
  const pendingScrollMessageId = useAppStore((s) => s.pendingScrollMessageId);
  const setPendingScrollMessageId = useAppStore((s) => s.setPendingScrollMessageId);

  // Jump-to-message (from search results): once the target message is in the
  // DOM, scroll it into view and flash it briefly. Deferred to a frame so it
  // runs AFTER ChatView's synchronous jump-to-bottom on conversation switch.
  useEffect(() => {
    if (!pendingScrollMessageId) return;
    const el = document.querySelector(`[data-message-id="${pendingScrollMessageId}"]`);
    if (!el) return; // conversation still loading — retry on next render
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'center' });
      el.classList.add('search-flash');
      setPendingScrollMessageId(null);
      setTimeout(() => el.classList.remove('search-flash'), 2000);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingScrollMessageId, messages, setPendingScrollMessageId]);

  return (
    <>
      {messages.map((m, i) => (
        <Message
          key={m.id}
          message={m}
          isLast={i === messages.length - 1}
          toolDefs={tools}
        />
      ))}
    </>
  );
}
