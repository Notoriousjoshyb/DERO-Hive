import type { ToolDefinition } from '@shared/types';

/**
 * Generated tool catalog: render the tools *as the model sees them*.
 *
 * Adapted from the DeepSeek Harness catalog generator (MIT) — see
 * HARNESS_INTEGRATION_PLAN.md, item 10. The idea worth copying is that the
 * catalog is produced by booting the tool list and reading the real schema,
 * never by parsing source: a schema built at runtime (capability flags, a
 * parameter added only when a feature is on) is not statically knowable, so a
 * hand-written table drifts silently.
 */

interface RenderedParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export function renderCatalog(tools: ToolDefinition[], generatedNote: string): string {
  const builtin = tools.filter((t) => t.source === 'builtin');
  const lines: string[] = [
    '# Tool Catalog',
    '',
    generatedNote,
    '',
    `${builtin.length} built-in tools. MCP tools are not listed here — they come from whatever servers are connected.`,
    ''
  ];

  for (const tool of [...builtin].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`## \`${tool.name}\``, '', tool.description, '');
    const params = paramsOf(tool);
    if (params.length === 0) {
      lines.push('No parameters.', '');
      continue;
    }
    lines.push('| Parameter | Type | Required | Description |', '|---|---|---|---|');
    for (const p of params) {
      lines.push(`| \`${p.name}\` | ${p.type} | ${p.required ? 'yes' : 'no'} | ${escapeCell(p.description)} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function paramsOf(tool: ToolDefinition): RenderedParam[] {
  const schema = tool.parameters as { properties?: Record<string, unknown>; required?: unknown };
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return Object.entries(properties).map(([name, raw]) => {
    const p = (raw ?? {}) as { type?: unknown; description?: unknown; items?: { type?: unknown }; enum?: unknown[] };
    return {
      name,
      type: typeName(p),
      required: required.has(name),
      description: typeof p.description === 'string' ? p.description : ''
    };
  });
}

function typeName(p: { type?: unknown; items?: { type?: unknown }; enum?: unknown[] }): string {
  if (Array.isArray(p.enum)) return p.enum.map((v) => `\`${String(v)}\``).join(' \\| ');
  const base = typeof p.type === 'string' ? p.type : 'any';
  if (base === 'array') {
    const item = p.items && typeof p.items.type === 'string' ? p.items.type : 'any';
    return `array of ${item}`;
  }
  return base;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}
