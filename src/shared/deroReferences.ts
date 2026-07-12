export interface DeroReference {
  type: 'scid' | 'address' | 'telaUrl' | 'transaction';
  label: string;
  value: string;
}

export interface DeroReferences {
  scids: string[];
  transactions: string[];
  addresses: string[];
  telaUrls: string[];
}

/** Extract likely DERO identifiers without claiming they are valid on-chain. */
export function extractDeroReferences(text: string): DeroReferences {
  const hex = [...text.matchAll(/\b[a-fA-F0-9]{64}\b/g)].map((match) => match[0]);
  const addresses = [...text.matchAll(/\bdero(?:1|test1)[a-z0-9]{20,}\b/gi)].map((match) => match[0]);
  const telaUrls = [...text.matchAll(/\b(?:tela|dero):\/\/[^\s<>()]+/gi)].map((match) => match[0]);
  return { scids: unique(hex), transactions: [], addresses: unique(addresses), telaUrls: unique(telaUrls) };
}

export function extractDeroReferenceItems(text: string): DeroReference[] {
  const items: DeroReference[] = [];
  const hex = [...text.matchAll(/\b[a-fA-F0-9]{64}\b/g)].map((match) => match[0]);
  for (const h of unique(hex)) {
    items.push({ type: 'scid', label: 'SCID/TX', value: h });
  }
  const addresses = [...text.matchAll(/\bdero(?:1|test1)[a-z0-9]{20,}\b/gi)].map((match) => match[0]);
  for (const a of unique(addresses)) {
    items.push({ type: 'address', label: 'Address', value: a });
  }
  const telaUrls = [...text.matchAll(/\b(?:tela|dero):\/\/[^\s<>()]+/gi)].map((match) => match[0]);
  for (const url of unique(telaUrls)) {
    items.push({ type: 'telaUrl', label: 'TELA', value: url });
  }
  return items;
}

export function hasDeroReferences(references: DeroReferences): boolean {
  return references.scids.length + references.transactions.length + references.addresses.length + references.telaUrls.length > 0;
}

export function formatDeroReferenceReceipt(references: DeroReferences): string {
  const rows = [
    references.scids.length ? `Possible SCID / transaction hashes: ${references.scids.join(', ')}` : '',
    references.addresses.length ? `Possible DERO addresses: ${references.addresses.join(', ')}` : '',
    references.telaUrls.length ? `TELA URLs: ${references.telaUrls.join(', ')}` : ''
  ].filter(Boolean);
  return `<dero_reference_receipt trust="unverified-user-input">\n${rows.join('\n')}\nThese are pattern matches, not verified chain facts. Use read-only DERO MCP or simulator tools to verify relevant identifiers before making claims.\n</dero_reference_receipt>`;
}

export interface DeroContextAttachment {
  type: 'contract-source' | 'contract-state' | 'gas-estimate' | 'transaction-context' | 'chain-health' | 'documentation';
  label: string;
  content: string;
  source: 'daemon' | 'documentation' | 'model-inference';
  provenance: string;
  confidence: 'verified' | 'high' | 'medium' | 'low';
  timestamp: number;
}

export function formatChainContextReceipt(attachments: DeroContextAttachment[]): string {
  if (!attachments.length) return '';
  const lines: string[] = [];
  lines.push('<dero_chain_context>');
  for (const a of attachments) {
    const evidenceLabel = a.source === 'daemon' ? '🔗 DAEMON EVIDENCE' :
                          a.source === 'documentation' ? '📚 DOCUMENTATION' :
                          '🤖 MODEL INFERENCE';
    lines.push(`  <attachment type="${a.type}" source="${a.source}" confidence="${a.confidence}" provenance="${a.provenance}" timestamp="${a.timestamp}">`);
    lines.push(`    <label>${a.label}</label>`);
    lines.push(`    <evidence>${evidenceLabel}</evidence>`);
    lines.push(`    <content>${a.content}</content>`);
    lines.push(`  </attachment>`);
  }
  lines.push('</dero_chain_context>');
  return lines.join('\n');
}

export function confidenceLabel(level: 'verified' | 'high' | 'medium' | 'low'): string {
  return level === 'verified' ? '✓ Verified (daemon-confirmed)' :
         level === 'high' ? '◉ High confidence (from docs/known patterns)' :
         level === 'medium' ? '○ Medium confidence (partial evidence)' :
         '◌ Low confidence (model inference, unverified)';
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
