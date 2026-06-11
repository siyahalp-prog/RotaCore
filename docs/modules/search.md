# Rota Search

Centralized search layer for RotaGlobal and future Rota products.

## Document model

```ts
{
  (id,
    type, // 'university' | 'scholarship' | 'country' | 'forum_post' | 'user' | 'blog_post' | 'company' | ...
    title,
    content,
    tags,
    metadata,
    source,
    createdAt,
    updatedAt);
}
```

## API

```ts
import { SearchService, InMemorySearchAdapter, PostgresSearchAdapter } from '@rota-core/search';

const search = new SearchService(new InMemorySearchAdapter());

// index universities
await search.indexDocument({
  id: 'u1',
  type: 'university',
  title: 'Technical University of Munich',
  content: 'Public research university in Munich, Germany.',
  tags: ['germany', 'engineering'],
  source: 'rotaglobal',
});

// index forum posts
await search.indexDocument({
  id: 'f42',
  type: 'forum_post',
  title: 'DAAD application experience',
  content: '...',
  tags: ['experience'],
  source: 'rotaglobal-forum',
});

// query scholarships
const result = await search.search('daad', { type: 'scholarship' }, { limit: 20, userId });

await search.deleteDocument('forum_post', 'f42');
```

## Ranking

Both adapters use the same weighting model:

| Signal              | Weight                          |
| ------------------- | ------------------------------- |
| Exact title match   | +10                             |
| Title token match   | +5 (Postgres tsvector weight A) |
| Tag token match     | +3 (weight B)                   |
| Content token match | +1 (weight C)                   |
| Recency boost       | up to +2 over the last 30 days  |

PostgreSQL adapter uses `websearch_to_tsquery` + `ts_rank` over a weighted
`tsvector` GIN index (`search_documents` table in `packages/db`).

## Search logs & analytics

Every `search()` call records `query`, `filters`, `result_count`, `user_id?`,
`created_at`. `popularQueries(limit)` aggregates the most frequent queries.

## Admin

`rebuildIndex(loadAll)` wipes the index and re-indexes from a loader
(array or async iterable) — used by the Admin Hub's "rebuild index" action.

## Future adapters

`SearchAdapter` is the boundary for Meilisearch / Typesense / OpenSearch /
Elasticsearch when PostgreSQL FTS is outgrown.
