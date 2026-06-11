/** Document types searchable across the Rota ecosystem. */
export type SearchDocumentType =
  | 'university'
  | 'scholarship'
  | 'country'
  | 'forum_post'
  | 'user'
  | 'blog_post'
  | 'company'
  | (string & {});

export type SearchDocument = {
  id: string;
  type: SearchDocumentType;
  title: string;
  content: string;
  tags: string[];
  metadata?: Record<string, unknown> | undefined;
  source: string;
  createdAt: Date;
  updatedAt: Date;
};

export type SearchFilters = {
  type?: SearchDocumentType | SearchDocumentType[];
  tags?: string[];
  source?: string;
};

export type SearchOptions = {
  limit?: number;
  offset?: number;
};

export type SearchHit = {
  document: SearchDocument;
  score: number;
};

export type SearchResult = {
  query: string;
  hits: SearchHit[];
  total: number;
};

export type SearchLogEntry = {
  id: string;
  query: string;
  filters?: SearchFilters | undefined;
  resultCount: number;
  userId?: string | undefined;
  createdAt: Date;
};
