import React, { Fragment } from 'react';
import { Box, Text } from 'ink';
import type { Message, ThinkingEffort, TokenUsage } from '../../../src/shared/types.js';
import type { ResolvedTerminalTheme } from './themes.js';

export interface PickerItem {
  id: string;
  label: string;
  detail?: string;
  group?: string;
  keywords?: string;
}

export interface ToolActivity {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'success' | 'error' | 'denied';
  result?: string;
  durationMs?: number;
  meta?: Record<string, unknown>;
}

export interface PermissionView {
  toolName: string;
  args: Record<string, unknown>;
  description?: string;
}

function shorten(value: string, max = 80): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length <= max ? singleLine : `${singleLine.slice(0, Math.max(0, max - 1))}…`;
}

function contentText(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  return message.content.map((part) => {
    if (part.type === 'text') return part.text;
    if (part.type === 'attachment_ref') return `@${part.attachment.filename}`;
    if (part.type === 'file') return `@${part.file.filename}`;
    if (part.type === 'image_url') return '[image]';
    if (part.type === 'input_audio') return '[audio]';
    return '';
  }).filter(Boolean).join('\n');
}

function viewportLines(text: string, width: number): string[] {
  const lines: string[] = [];
  const safeWidth = Math.max(20, width);
  for (const sourceLine of text.replace(/\r\n/g, '\n').split('\n')) {
    if (sourceLine.length <= safeWidth) {
      lines.push(sourceLine);
      continue;
    }
    for (let offset = 0; offset < sourceLine.length; offset += safeWidth) {
      lines.push(sourceLine.slice(offset, offset + safeWidth));
    }
  }
  return lines.length ? lines : [''];
}

function Inline({ text, theme }: { text: string; theme: ResolvedTerminalTheme }): JSX.Element {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const chunks = text.split(pattern);
  return (
    <Text color={theme.palette.foreground}>
      {chunks.map((chunk, index) => {
        if (chunk.startsWith('**') && chunk.endsWith('**')) {
          return <Text key={index} bold>{chunk.slice(2, -2)}</Text>;
        }
        if (chunk.startsWith('`') && chunk.endsWith('`')) {
          return <Text key={index} color={theme.palette.accent}>{chunk.slice(1, -1)}</Text>;
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(chunk);
        if (link) return <Text key={index} color={theme.palette.info} underline>{link[1]}</Text>;
        return <Fragment key={index}>{chunk}</Fragment>;
      })}
    </Text>
  );
}

export function MarkdownBlock({ text, theme, maxLines }: {
  text: string;
  theme: ResolvedTerminalTheme;
  maxLines?: number;
}): JSX.Element {
  const rawLines = text.replace(/\r\n/g, '\n').split('\n');
  const lines = maxLines && rawLines.length > maxLines
    ? [...rawLines.slice(0, Math.max(1, maxLines - 1)), `… ${rawLines.length - maxLines + 1} more line(s)`]
    : rawLines;
  let inCode = false;
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => {
        if (/^\s*```/.test(line)) {
          inCode = !inCode;
          const language = line.replace(/^\s*```/, '').trim();
          return (
            <Text key={index} color={theme.palette.subtle}>
              {inCode ? `┌─ ${language || 'code'}` : '└─'}
            </Text>
          );
        }
        if (inCode) {
          return <Text key={index} color={theme.palette.foreground} backgroundColor={theme.palette.codeBackground}>  {line || ' '}</Text>;
        }
        const heading = /^(#{1,4})\s+(.+)$/.exec(line);
        if (heading) return <Text key={index} color={theme.palette.accent} bold>{heading[2]}</Text>;
        const quote = /^\s*>\s?(.*)$/.exec(line);
        if (quote) return <Text key={index} color={theme.palette.muted}>│ <Inline text={quote[1]} theme={theme} /></Text>;
        const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
        if (bullet) return <Text key={index}><Text color={theme.palette.accent}>• </Text><Inline text={bullet[1]} theme={theme} /></Text>;
        const ordered = /^\s*(\d+)\.\s+(.+)$/.exec(line);
        if (ordered) return <Text key={index}><Text color={theme.palette.accent}>{ordered[1]}. </Text><Inline text={ordered[2]} theme={theme} /></Text>;
        if (/^\s*[-*_]{3,}\s*$/.test(line)) return <Text key={index} color={theme.palette.borderStrong}>{'─'.repeat(36)}</Text>;
        return <Inline key={index} text={line || ' '} theme={theme} />;
      })}
    </Box>
  );
}

function MessageCard({ message, theme, showReasoning, showToolDetails }: {
  message: Message;
  theme: ResolvedTerminalTheme;
  showReasoning: boolean;
  showToolDetails: boolean;
}): JSX.Element {
  const text = contentText(message);
  if (message.role === 'tool') {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={theme.palette.border} paddingX={1}>
        <Text color={theme.palette.muted}>✓ {message.name || 'tool'} <Text color={theme.palette.subtle}>{shorten(text, 110)}</Text></Text>
        {showToolDetails && <MarkdownBlock text={text} theme={theme} maxLines={12} />}
      </Box>
    );
  }
  const user = message.role === 'user';
  const system = message.role === 'system';
  const label = user ? 'YOU' : system ? 'CONTEXT' : 'HIVE';
  const color = user ? theme.palette.info : system ? theme.palette.muted : theme.palette.accent;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color} bold>{label}</Text>
      {message.reasoning && showReasoning && (
        <Box flexDirection="column" borderStyle="single" borderColor={theme.palette.border} paddingX={1} marginBottom={1}>
          <Text color={theme.palette.muted}>thinking{showToolDetails ? ' · expanded' : ` · ${shorten(message.reasoning, 180)}`}</Text>
          {showToolDetails && <MarkdownBlock text={message.reasoning} theme={theme} maxLines={16} />}
        </Box>
      )}
      <MarkdownBlock text={text || ' '} theme={theme} maxLines={system ? 8 : undefined} />
      {message.toolCalls?.length ? (
        <Text color={theme.palette.subtle}>
          {message.toolCalls.map((call) => `↳ ${call.function.name}`).join('  ')}
        </Text>
      ) : null}
      {message.usage && (
        <Text color={theme.palette.subtle}>{message.model ? `${message.model} · ` : ''}{message.usage.totalTokens.toLocaleString()} tokens</Text>
      )}
    </Box>
  );
}

export function ToolRow({ tool, theme, expanded }: {
  tool: ToolActivity;
  theme: ResolvedTerminalTheme;
  expanded: boolean;
}): JSX.Element {
  const icon = tool.status === 'running' ? '◌' : tool.status === 'success' ? '✓' : tool.status === 'denied' ? '⊘' : '×';
  const color = tool.status === 'running' ? theme.palette.info
    : tool.status === 'success' ? theme.palette.success
    : tool.status === 'denied' ? theme.palette.warning
    : theme.palette.danger;
  const summary = Object.entries(tool.args).slice(0, 2).map(([key, value]) => `${key}=${shorten(String(value), 44)}`).join(' ');
  const meta = tool.meta || {};
  const change = typeof meta.linesAdded === 'number' || typeof meta.linesRemoved === 'number'
    ? ` +${String(meta.linesAdded || 0)} -${String(meta.linesRemoved || 0)}` : '';
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.palette.border} paddingX={1}>
      <Text color={color}>{icon} <Text bold>{tool.name}</Text><Text color={theme.palette.muted}> {summary}</Text>{change}<Text color={theme.palette.subtle}>{tool.durationMs !== undefined ? ` · ${tool.durationMs}ms` : ''}</Text></Text>
      {expanded && tool.result && <MarkdownBlock text={tool.result} theme={theme} maxLines={14} />}
    </Box>
  );
}

export function Transcript({ messages, live, tools, theme, height, width, scrollOffset, focusMode, showReasoning, showToolDetails }: {
  messages: Message[];
  live?: Message;
  tools: ToolActivity[];
  theme: ResolvedTerminalTheme;
  height: number;
  width: number;
  scrollOffset: number;
  focusMode: boolean;
  showReasoning: boolean;
  showToolDetails: boolean;
}): JSX.Element {
  const all = live ? [...messages, live] : messages;
  const visibleSource = focusMode ? all.slice(-2) : all;
  const lastTool = tools.at(-1);
  const expandedTool = Boolean(showToolDetails || lastTool?.status === 'error');
  const visibleTools = scrollOffset === 0
    ? tools.slice(expandedTool ? -1 : -3)
    : [];
  const toolBudget = visibleTools.length * (expandedTool ? 17 : 3);
  const latest = visibleSource.at(-1);
  const latestLines = latest ? viewportLines(contentText(latest), width - 4) : [];
  const reasoningBudget = latest?.reasoning && showReasoning ? (showToolDetails ? 19 : 3) : 0;
  const contentBudget = Math.max(3, height - toolBudget - reasoningBudget - 4);
  const latestMaxOffset = Math.max(0, latestLines.length - contentBudget);
  const scrollingLongMessage = latestMaxOffset > 0 && scrollOffset <= latestMaxOffset;
  const longMessageOffset = scrollingLongMessage ? scrollOffset : 0;
  const longEnd = latestLines.length - longMessageOffset;
  const longStart = Math.max(0, longEnd - contentBudget);
  const longText = latest && scrollingLongMessage
    ? [
        ...(longStart > 0 ? [`… ${longStart} earlier line(s)`] : []),
        ...latestLines.slice(longStart, longEnd),
        ...(longEnd < latestLines.length ? [`… ${latestLines.length - longEnd} later line(s)`] : [])
      ].join('\n')
    : '';
  const blockBudget = Math.max(2, Math.floor(height / 5));
  const page = Math.max(1, Math.floor(height / 4));
  const messageOffset = scrollOffset > latestMaxOffset
    ? Math.max(0, Math.ceil((scrollOffset - latestMaxOffset) / page))
    : latestMaxOffset === 0 ? Math.floor(scrollOffset / page) : 0;
  const end = Math.max(0, visibleSource.length - messageOffset);
  const start = Math.max(0, end - blockBudget);
  const visible = scrollingLongMessage && latest
    ? [{ ...latest, content: longText }]
    : visibleSource.slice(start, end);
  return (
    <Box flexDirection="column" height={Math.max(3, height)} overflow="hidden">
      {visible.length === 0 ? (
        <Box flexDirection="column" paddingTop={1}>
          <Text color={theme.palette.accent} bold>What are we building?</Text>
          <Text color={theme.palette.muted}>Describe a task, type <Text color={theme.palette.accent}>/</Text> for commands, <Text color={theme.palette.accent}>@</Text> for files, or <Text color={theme.palette.accent}>!</Text> for shell.</Text>
        </Box>
      ) : visible.map((message) => (
        <MessageCard key={message.id} message={message} theme={theme} showReasoning={showReasoning} showToolDetails={showToolDetails} />
      ))}
      {visibleTools.map((tool) => (
        <ToolRow key={tool.id} tool={tool} theme={theme} expanded={showToolDetails || tool.status === 'error'} />
      ))}
      {scrollingLongMessage && <Text color={theme.palette.subtle}>PageUp/PageDown · {longMessageOffset} line(s) from latest</Text>}
      {!scrollingLongMessage && start > 0 && <Text color={theme.palette.subtle}>↑ {start} earlier message(s) · PageUp</Text>}
    </Box>
  );
}

export function Header({ theme, title, online, queued }: {
  theme: ResolvedTerminalTheme;
  title: string;
  online: 'idle' | 'working' | 'error';
  queued: number;
}): JSX.Element {
  const statusColor = online === 'working' ? theme.palette.warning : online === 'error' ? theme.palette.danger : theme.palette.success;
  return (
    <Box justifyContent="space-between" borderBottom borderColor={theme.palette.border} paddingX={1}>
      <Text><Text color={theme.palette.accent} bold>⬡ DERO HIVE</Text><Text color={theme.palette.muted}>  {shorten(title, 54)}</Text></Text>
      <Text color={statusColor}>{online === 'working' ? '● working' : online === 'error' ? '● attention' : '● ready'}{queued ? ` · ${queued} queued` : ''}</Text>
    </Box>
  );
}

export function Picker({ title, items, selected, theme, hint, maxItems = 9 }: {
  title: string;
  items: PickerItem[];
  selected: number;
  theme: ResolvedTerminalTheme;
  hint?: string;
  maxItems?: number;
}): JSX.Element {
  const safe = Math.max(0, Math.min(items.length - 1, selected));
  const visibleCount = Math.max(3, maxItems);
  const start = Math.max(0, Math.min(safe - Math.floor(visibleCount / 2), items.length - visibleCount));
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.palette.accent} paddingX={1}>
      <Text color={theme.palette.accent} bold>{title}</Text>
      {hint && <Text color={theme.palette.subtle}>{hint}</Text>}
      {items.length === 0 ? <Text color={theme.palette.muted}>No matches</Text> : items.slice(start, start + visibleCount).map((item, index) => {
        const active = start + index === safe;
        return (
          <Text key={item.id} color={active ? theme.palette.accent : theme.palette.foreground} inverse={active}>
            {active ? '›' : ' '} {item.group ? `${item.group} / ` : ''}{item.label}{item.detail ? `  ${item.detail}` : ''}
          </Text>
        );
      })}
    </Box>
  );
}

export function PermissionPrompt({ request, theme }: { request: PermissionView; theme: ResolvedTerminalTheme }): JSX.Element {
  const args = JSON.stringify(request.args, null, 2);
  return (
    <Box flexDirection="column" borderStyle="double" borderColor={theme.palette.warning} paddingX={1}>
      <Text color={theme.palette.warning} bold>Permission required · {request.toolName}</Text>
      {request.description && <Text color={theme.palette.muted}>{request.description}</Text>}
      <MarkdownBlock text={args} theme={theme} maxLines={10} />
      <Text><Text color={theme.palette.success}>[a] allow once</Text>  <Text color={theme.palette.accent}>[p] allow for project</Text>  <Text color={theme.palette.warning}>[g] always allow</Text>  <Text color={theme.palette.danger}>[d] deny</Text></Text>
    </Box>
  );
}

export function StatusBar({ theme, provider, model, reasoning, planMode, agent, approval, cwd, usage }: {
  theme: ResolvedTerminalTheme;
  provider: string;
  model: string;
  reasoning: ThinkingEffort;
  planMode: boolean;
  agent: string;
  approval: string;
  cwd: string;
  usage: TokenUsage;
}): JSX.Element {
  const tail = cwd.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/');
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text color={theme.palette.muted}>{provider || 'no provider'} / <Text color={theme.palette.foreground}>{model || 'no model'}</Text> · think:{reasoning} · {planMode ? 'plan' : 'build'} · {agent}</Text>
      <Text color={theme.palette.subtle}>{approval} · {usage.totalTokens.toLocaleString()} tok · {tail || '.'}</Text>
    </Box>
  );
}
