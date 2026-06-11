import { newId, systemClock, type Clock } from '@rota-core/core';
import type { SearchAdapter } from './adapter.js';
import type {
  SearchDocument,
  SearchFilters,
  SearchLogEntry,
  SearchOptions,
  SearchResult,
} from './types.js';

export type SearchLogStore = {
  insert(entry: SearchLogEntry): Promise<void>;
  list(limit?: number): Promise<SearchLogEntry[]>;
};

export class InMemorySearchLogStore implements SearchLogStore {
  private readonly entries: SearchLogEntry[] = [];

  async insert(entry: SearchLogEntry): Promise<void> {
    this.entries.push({ ...entry });
  }

  async list(limit = 1000): Promise<SearchLogEntry[]> {
    return this.entries.slice(-limit).map((e) => ({ ...e }));
  }
}

export type IndexDocumentInput = Omit<SearchDocument, 'createdAt' | 'updatedAt'> & {
  createdAt?: Date;
  updatedAt?: Date;
};

export class SearchService {
  constructor(
    private readonly adapter: SearchAdapter,
    private readonly logStore: SearchLogStore = new InMemorySearchLogStore(),
    private readonly clock: Clock = systemClock,
  ) {}

  async indexDocument(input: IndexDocumentInput): Promise<void> {
    const now = this.clock.now();
    await this.adapter.indexDocument({
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    });
  }

  async deleteDocument(type: string, id: string): Promise<void> {
    await this.adapter.deleteDocument(type, id);
  }

  /** Search and record a search log entry (used for popular-query analytics). */
  async search(
    query: string,
    filters?: SearchFilters,
    options?: SearchOptions & { userId?: string },
  ): Promise<SearchResult> {
    const result = await this.adapter.search(query, filters, options);
    await this.logStore.insert({
      id: newId(),
      query,
      filters,
      resultCount: result.total,
      userId: options?.userId,
      createdAt: this.clock.now(),
    });
    return result;
  }

  async popularQueries(limit = 10): Promise<{ query: string; count: number }[]> {
    const logs = await this.logStore.list();
    const counts = new Map<string, number>();
    for (const log of logs) {
      const key = log.query.trim().toLowerCase();
      if (key === '') continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Admin function: wipe the index and re-index every document from a source loader.
   * The loader can stream documents from the product database in batches.
   */
  async rebuildIndex(
    loadAll: () => AsyncIterable<SearchDocument> | Promise<SearchDocument[]>,
  ): Promise<number> {
    await this.adapter.clear();
    const documents = await loadAll();
    let count = 0;
    if (Symbol.asyncIterator in Object(documents)) {
      for await (const doc of documents as AsyncIterable<SearchDocument>) {
        await this.adapter.indexDocument(doc);
        count += 1;
      }
    } else {
      for (const doc of documents as SearchDocument[]) {
        await this.adapter.indexDocument(doc);
        count += 1;
      }
    }
    return count;
  }
}
