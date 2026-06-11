import type { SearchDocument, SearchFilters, SearchOptions, SearchResult } from './types.js';

/**
 * Search backend boundary.
 * Implementations: InMemorySearchAdapter (tests/dev), PostgresSearchAdapter (production).
 * Future adapters: Meilisearch, Typesense, OpenSearch, Elasticsearch.
 */
export type SearchAdapter = {
  indexDocument(document: SearchDocument): Promise<void>;
  deleteDocument(type: string, id: string): Promise<void>;
  search(query: string, filters?: SearchFilters, options?: SearchOptions): Promise<SearchResult>;
  /** Remove all documents (used by rebuildIndex). */
  clear(): Promise<void>;
};
