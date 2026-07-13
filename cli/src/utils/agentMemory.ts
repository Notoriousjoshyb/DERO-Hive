export interface AgentMemoryEntry {
  id: string;
  content: string;
  createdAt: number;
  updatedAt?: number;
  tags?: readonly string[];
  source?: string;
  pinned?: boolean;
}

export interface MemorySearchQuery {
  text: string;
  phrases: string[];
  tags: string[];
  sources: string[];
  before?: number;
  after?: number;
}

export interface MemoryScoreWeights {
  lexical: number;
  recency: number;
  tags: number;
  pinned: number;
}

export interface MemoryRankOptions {
  now?: number;
  limit?: number;
  minScore?: number;
  queryTags?: readonly string[];
  sources?: readonly string[];
  halfLifeDays?: number;
  weights?: Partial<MemoryScoreWeights>;
}

export interface RankedMemory {
  entry: AgentMemoryEntry;
  score: number;
  lexicalScore: number;
  recencyScore: number;
  tagScore: number;
  pinScore: number;
}

const DAY_MS = 86_400_000;
const DEFAULT_WEIGHTS: MemoryScoreWeights = Object.freeze({
  lexical: 0.55,
  recency: 0.2,
  tags: 0.15,
  pinned: 0.1
});

function normalizeTag(tag: string): string {
  return normalizeMemoryText(tag).replace(/^#+/u, '').replace(/\s+/gu, '-');
}

function memoryTimestamp(entry: AgentMemoryEntry): number {
  if (Number.isFinite(entry.updatedAt)) return entry.updatedAt as number;
  return Number.isFinite(entry.createdAt) ? entry.createdAt : 0;
}

function normalizedWeights(overrides?: Partial<MemoryScoreWeights>): MemoryScoreWeights {
  const candidate: MemoryScoreWeights = {
    lexical: overrides?.lexical ?? DEFAULT_WEIGHTS.lexical,
    recency: overrides?.recency ?? DEFAULT_WEIGHTS.recency,
    tags: overrides?.tags ?? DEFAULT_WEIGHTS.tags,
    pinned: overrides?.pinned ?? DEFAULT_WEIGHTS.pinned
  };
  for (const key of Object.keys(candidate) as (keyof MemoryScoreWeights)[]) {
    if (!Number.isFinite(candidate[key]) || candidate[key] < 0) candidate[key] = 0;
  }
  const sum = candidate.lexical + candidate.recency + candidate.tags + candidate.pinned;
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  return {
    lexical: candidate.lexical / sum,
    recency: candidate.recency / sum,
    tags: candidate.tags / sum,
    pinned: candidate.pinned / sum
  };
}

function normalizedLimit(limit: number | undefined, fallback: number, maximum = 100): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(maximum, Math.max(0, Math.floor(limit)));
}

export function normalizeMemoryText(input: string): string {
  return input.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
}

export function tokenizeMemoryText(input: string): string[] {
  return normalizeMemoryText(input).match(/[\p{L}\p{N}]+(?:['_-][\p{L}\p{N}]+)*/gu) ?? [];
}

export function mergeMemoryTags(...groups: readonly (readonly string[])[]): string[] {
  const tags = new Set<string>();
  for (const group of groups) {
    for (const tag of group) {
      const normalized = normalizeTag(tag);
      if (normalized) tags.add(normalized);
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

export function memoryFingerprint(entry: Pick<AgentMemoryEntry, 'id' | 'content'>): string {
  const content = normalizeMemoryText(entry.content);
  return content || `empty:${entry.id}`;
}

export function jaccardSimilarity(left: string, right: string): number {
  const a = new Set(tokenizeMemoryText(left));
  const b = new Set(tokenizeMemoryText(right));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function tagOverlapScore(queryTags: readonly string[], memoryTags: readonly string[] = []): number {
  const query = new Set(mergeMemoryTags(queryTags));
  if (query.size === 0) return 0;
  const available = new Set(mergeMemoryTags(memoryTags));
  let matches = 0;
  for (const tag of query) if (available.has(tag)) matches += 1;
  return matches / query.size;
}

export function memoryRecencyScore(timestamp: number, now = Date.now(), halfLifeDays = 30): number {
  if (!Number.isFinite(timestamp)) return 0;
  const reference = Number.isFinite(now) ? now : Date.now();
  const halfLife = Number.isFinite(halfLifeDays) && halfLifeDays > 0 ? halfLifeDays : 30;
  const age = Math.max(0, reference - timestamp);
  return Math.pow(0.5, age / (halfLife * DAY_MS));
}

export function summarizeMemoryContent(content: string, maxChars = 240): string {
  const printable = [...content].filter((character) => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || code >= 32;
  }).join('');
  const normalized = printable.replace(/\s+/gu, ' ').trim();
  const limit = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 240;
  if (limit === 0) return '';
  if (normalized.length <= limit) return normalized;
  if (limit === 1) return '…';
  const candidate = normalized.slice(0, limit - 1);
  const wordBoundary = candidate.lastIndexOf(' ');
  const cutoff = wordBoundary >= Math.floor(limit * 0.6) ? wordBoundary : candidate.length;
  return `${candidate.slice(0, cutoff).trimEnd()}…`;
}

export function parseMemorySearchQuery(input: string): MemorySearchQuery {
  const result: MemorySearchQuery = { text: '', phrases: [], tags: [], sources: [] };
  const plain: string[] = [];
  const tokenPattern = /"((?:\\.|[^"\\])*)"|(\S+)/gu;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(input)) !== null) {
    if (match[1] !== undefined) {
      const phrase = match[1].replace(/\\([\\"])/gu, '$1').trim();
      if (phrase) result.phrases.push(phrase);
      continue;
    }
    const token = match[2];
    const separator = token.indexOf(':');
    const field = separator > 0 ? token.slice(0, separator).toLocaleLowerCase('en-US') : '';
    const value = separator > 0 ? token.slice(separator + 1) : '';
    if (field === 'tag' && value) result.tags.push(value);
    else if (field === 'source' && value) result.sources.push(value);
    else if ((field === 'before' || field === 'after') && value) {
      const timestamp = Date.parse(value);
      if (Number.isFinite(timestamp)) result[field] = timestamp;
    } else plain.push(token);
  }
  result.text = plain.join(' ').trim();
  result.tags = mergeMemoryTags(result.tags);
  result.sources = mergeMemoryTags(result.sources);
  return result;
}

export function filterMemories(entries: readonly AgentMemoryEntry[], query: string | MemorySearchQuery): AgentMemoryEntry[] {
  const parsed = typeof query === 'string' ? parseMemorySearchQuery(query) : query;
  const queryTokens = tokenizeMemoryText(parsed.text);
  const phrases = parsed.phrases.map(normalizeMemoryText);
  const requiredTags = mergeMemoryTags(parsed.tags);
  const requiredSources = new Set(mergeMemoryTags(parsed.sources));
  return entries.filter((entry) => {
    const content = normalizeMemoryText(entry.content);
    const contentTokens = new Set(tokenizeMemoryText(content));
    const tags = new Set(mergeMemoryTags(entry.tags ?? []));
    const source = normalizeTag(entry.source ?? '');
    const timestamp = memoryTimestamp(entry);
    if (queryTokens.some((token) => !contentTokens.has(token))) return false;
    if (phrases.some((phrase) => !content.includes(phrase))) return false;
    if (requiredTags.some((tag) => !tags.has(tag))) return false;
    if (requiredSources.size > 0 && !requiredSources.has(source)) return false;
    if (parsed.before !== undefined && timestamp >= parsed.before) return false;
    if (parsed.after !== undefined && timestamp <= parsed.after) return false;
    return true;
  });
}

export function scoreMemory(
  entry: AgentMemoryEntry,
  query: string,
  options: Omit<MemoryRankOptions, 'limit' | 'minScore' | 'sources'> = {}
): RankedMemory {
  const lexicalScore = jaccardSimilarity(query, entry.content);
  const recencyScore = memoryRecencyScore(memoryTimestamp(entry), options.now, options.halfLifeDays);
  const tagScore = tagOverlapScore(options.queryTags ?? [], entry.tags);
  const pinScore = entry.pinned ? 1 : 0;
  const weights = normalizedWeights(options.weights);
  const score = lexicalScore * weights.lexical
    + recencyScore * weights.recency
    + tagScore * weights.tags
    + pinScore * weights.pinned;
  return { entry, score, lexicalScore, recencyScore, tagScore, pinScore };
}

export function rankMemories(
  entries: readonly AgentMemoryEntry[],
  query: string,
  options: MemoryRankOptions = {}
): RankedMemory[] {
  const sources = new Set(mergeMemoryTags(options.sources ?? []));
  const minimum = Number.isFinite(options.minScore) ? Math.max(0, options.minScore as number) : 0;
  const limit = normalizedLimit(options.limit, 10);
  return entries
    .filter((entry) => sources.size === 0 || sources.has(normalizeTag(entry.source ?? '')))
    .map((entry) => scoreMemory(entry, query, options))
    .filter((ranked) => ranked.score >= minimum)
    .sort((a, b) => b.score - a.score
      || memoryTimestamp(b.entry) - memoryTimestamp(a.entry)
      || a.entry.id.localeCompare(b.entry.id))
    .slice(0, limit);
}

export function deduplicateMemories(entries: readonly AgentMemoryEntry[]): AgentMemoryEntry[] {
  const selected = new Map<string, AgentMemoryEntry>();
  for (const entry of entries) {
    const fingerprint = memoryFingerprint(entry);
    const current = selected.get(fingerprint);
    if (!current
      || Number(entry.pinned) > Number(current.pinned)
      || (Boolean(entry.pinned) === Boolean(current.pinned) && memoryTimestamp(entry) > memoryTimestamp(current))
      || (Boolean(entry.pinned) === Boolean(current.pinned)
        && memoryTimestamp(entry) === memoryTimestamp(current)
        && entry.id.localeCompare(current.id) < 0)) {
      selected.set(fingerprint, entry);
    }
  }
  return [...selected.values()];
}

export function estimateMemoryTokens(content: string): number {
  const normalized = content.trim();
  return normalized ? Math.ceil(normalized.length / 4) : 0;
}

export function selectMemoriesForBudget(memories: readonly RankedMemory[], tokenBudget: number): RankedMemory[] {
  const budget = Number.isFinite(tokenBudget) ? Math.max(0, Math.floor(tokenBudget)) : 0;
  const selected: RankedMemory[] = [];
  let used = 0;
  for (const memory of memories) {
    const cost = estimateMemoryTokens(summarizeMemoryContent(memory.entry.content));
    if (cost > 0 && used + cost <= budget) {
      selected.push(memory);
      used += cost;
    }
  }
  return selected;
}

export function buildMemoryContext(
  entries: readonly AgentMemoryEntry[],
  query: string,
  options: MemoryRankOptions & { tokenBudget?: number; maxContentChars?: number } = {}
): string {
  const ranked = rankMemories(entries, query, options);
  const selected = options.tokenBudget === undefined
    ? ranked
    : selectMemoriesForBudget(ranked, options.tokenBudget);
  return selected.map(({ entry }) => {
    const source = normalizeTag(entry.source ?? 'memory') || 'memory';
    const tags = mergeMemoryTags(entry.tags ?? []);
    const tagSuffix = tags.length > 0 ? ` (tags: ${tags.join(', ')})` : '';
    return `- [${source}] ${summarizeMemoryContent(entry.content, options.maxContentChars)}${tagSuffix}`;
  }).join('\n');
}
