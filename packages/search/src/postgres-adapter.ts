import type { SqlClient } from '@rota-core/db';
import type { SearchAdapter } from './adapter.js';
import type { SearchDocument, SearchFilters, SearchOptions, SearchResult } from './types.js';

type DocumentRow = {
  id: string;
  type: string;
  title: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown> | null;
  source: string;
  created_at: Date | string;
  updated_at: Date | string;
  score?: number;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function rowToDocument(row: DocumentRow): SearchDocument {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    tags: row.tags,
    ...(row.metadata !== null ? { metadata: row.metadata } : {}),
    source: row.source,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

/**
 * PostgreSQL full-text search adapter.
 * Ranking: ts_rank over a weighted tsvector (title = A, tags = B, content = C),
 * plus an exact-title boost and a 30-day recency boost — the same weighting
 * model as the in-memory adapter.
 */
export class PostgresSearchAdapter implements SearchAdapter {
  constructor(private readonly sql: SqlClient) {}

  async indexDocument(document: SearchDocument): Promise<void> {
    await this.sql.query(
      `INSERT INTO search_documents
        (id, type, title, content, tags, metadata, source, created_at, updated_at, search_vector)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
         setweight(to_tsvector('simple', $3), 'A') ||
         setweight(to_tsvector('simple', array_to_string($5, ' ')), 'B') ||
         setweight(to_tsvector('simple', $4), 'C'))
       ON CONFLICT (type, id) DO UPDATE SET
         title = EXCLUDED.title,
         content = EXCLUDED.content,
         tags = EXCLUDED.tags,
         metadata = EXCLUDED.metadata,
         source = EXCLUDED.source,
         updated_at = EXCLUDED.updated_at,
         search_vector = EXCLUDED.search_vector`,
      [
        document.id,
        document.type,
        document.title,
        document.content,
        document.tags,
        document.metadata !== undefined ? JSON.stringify(document.metadata) : null,
        document.source,
        document.createdAt,
        document.updatedAt,
      ],
    );
  }

  async deleteDocument(type: string, id: string): Promise<void> {
    await this.sql.query(`DELETE FROM search_documents WHERE type = $1 AND id = $2`, [type, id]);
  }

  async search(
    query: string,
    filters?: SearchFilters,
    options: SearchOptions = {},
  ): Promise<SearchResult> {
    const wheres = [`search_vector @@ websearch_to_tsquery('simple', $1)`];
    const params: unknown[] = [query];

    if (filters?.type !== undefined) {
      const types = Array.isArray(filters.type) ? filters.type : [filters.type];
      params.push(types);
      wheres.push(`type = ANY($${params.length})`);
    }
    if (filters?.tags !== undefined && filters.tags.length > 0) {
      params.push(filters.tags);
      wheres.push(`tags @> $${params.length}`);
    }
    if (filters?.source !== undefined) {
      params.push(filters.source);
      wheres.push(`source = $${params.length}`);
    }

    params.push(options.limit ?? 20);
    const limitIdx = params.length;
    params.push(options.offset ?? 0);
    const offsetIdx = params.length;

    const result = await this.sql.query<DocumentRow & { total: number | string }>(
      `SELECT *,
         (ts_rank(search_vector, websearch_to_tsquery('simple', $1)) * 10
          + CASE WHEN lower(title) = lower($1) THEN 10 ELSE 0 END
          + GREATEST(0, 2 * (1 - EXTRACT(EPOCH FROM (now() - updated_at)) / (30 * 24 * 3600)))
         ) AS score,
         COUNT(*) OVER() AS total
       FROM search_documents
       WHERE ${wheres.join(' AND ')}
       ORDER BY score DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    const firstRow = result.rows[0];
    return {
      query,
      hits: result.rows.map((row) => ({
        document: rowToDocument(row),
        score: Number(row.score ?? 0),
      })),
      total: firstRow !== undefined ? Number(firstRow.total) : 0,
    };
  }

  async clear(): Promise<void> {
    await this.sql.query(`DELETE FROM search_documents`);
  }
}
