import { useAppStore } from '../stores/app';
import { Message } from './Message';

export function MessageList(): JSX.Element {
  const messages = useAppStore((s) => s.currentMessages);
  const tools = useAppStore((s) => s.tools);

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