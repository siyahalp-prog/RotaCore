import type { SearchAdapter } from './adapter.js';
import type {
  SearchDocument,
  SearchFilters,
  SearchHit,
  SearchOptions,
  SearchResult,
} from './types.js';

const RECENCY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

function matchesFilters(doc: SearchDocument, filters?: SearchFilters): boolean {
  if (filters === undefined) return true;
  if (filters.type !== undefined) {
    const types = Array.isArray(filters.type) ? filters.type : [filters.type];
    if (!types.includes(doc.type)) return false;
  }
  if (filters.tags !== undefined && filters.tags.length > 0) {
    const docTags = new Set(doc.tags.map((t) => t.toLowerCase()));
    if (!filters.tags.every((tag) => docTags.has(tag.toLowerCase()))) return false;
  }
  if (filters.source !== undefined && doc.source !== filters.source) return false;
  return true;
}

/**
 * Ranking (mirrors the weights used by the PostgreSQL adapter):
 *   exact title match  +10
 *   per title token    +5
 *   per tag token      +3
 *   per content token  +1
 *   recency boost      up to +2 (linear over 30 days)
 */
export function scoreDocument(doc: SearchDocument, query: string, now: Date): number {
  const queryLower = query.trim().toLowerCase();
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;

  let score = 0;
  if (doc.title.trim().toLowerCase() === queryLower) score += 10;

  const titleTokens = new Set(tokenize(doc.title));
  const tagTokens = new Set(doc.tags.flatMap(tokenize));
  const contentTokens = new Set(tokenize(doc.content));

  let matched = false;
  for (const token of queryTokens) {
    if (titleTokens.has(token)) {
      score += 5;
      matched = true;
    }
    if (tagTokens.has(token)) {
      score += 3;
      matched = true;
    }
    if (contentTokens.has(token)) {
      score += 1;
      matched = true;
    }
  }
  if (!matched && score === 0) return 0;

  const age = now.getTime() - doc.updatedAt.getTime();
  if (age >= 0 && age < RECENCY_WINDOW_MS) {
    score += 2 * (1 - age / RECENCY_WINDOW_MS);
  }
  return score;
}

export class InMemorySearchAdapter implements SearchAdapter {
  private readonly documents = new Map<string, SearchDocument>();

  private key(type: string, id: string): string {
    return `${type}:${id}`;
  }

  async indexDocument(document: SearchDocument): Promise<void> {
    this.documents.set(this.key(document.type, document.id), { ...document });
  }

  async deleteDocument(type: string, id: string): Promise<void> {
    this.documents.delete(this.key(type, id));
  }

  async search(
    query: string,
    filters?: SearchFilters,
    options: SearchOptions = {},
  ): Promise<SearchResult> {
    const now = new Date();
    const hits: SearchHit[] = [];
    for (const doc of this.documents.values()) {
      if (!matchesFilters(doc, filters)) continue;
      const score = scoreDocument(doc, query, now);
      if (score > 0) hits.push({ document: { ...doc }, score });
    }
    hits.sort((a, b) => b.score - a.score);
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 20;
    return { query, hits: hits.slice(offset, offset + limit), total: hits.length };
  }

  async clear(): Promise<void> {
    this.documents.clear();
  }
}
