import { describe, expect, it } from 'vitest';
import { InMemorySearchAdapter, SearchService } from '../src/index.js';
import type { SearchDocument } from '../src/index.js';

function doc(
  partial: Partial<SearchDocument> & Pick<SearchDocument, 'id' | 'type' | 'title'>,
): SearchDocument {
  return {
    content: '',
    tags: [],
    source: 'test',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

async function seededService() {
  const adapter = new InMemorySearchAdapter();
  const service = new SearchService(adapter);
  await service.indexDocument(
    doc({
      id: 'u1',
      type: 'university',
      title: 'Technical University of Munich',
      content: 'Public research university in Munich, Germany.',
      tags: ['germany', 'engineering'],
    }),
  );
  await service.indexDocument(
    doc({
      id: 's1',
      type: 'scholarship',
      title: 'DAAD Scholarship',
      content: 'Funding for international students studying in Germany.',
      tags: ['germany', 'masters'],
    }),
  );
  await service.indexDocument(
    doc({
      id: 'f1',
      type: 'forum_post',
      title: 'My experience applying to DAAD',
      content: 'I applied to the DAAD scholarship last year and got accepted.',
      tags: ['experience'],
    }),
  );
  return { adapter, service };
}

describe('Rota Search', () => {
  it('indexes and finds documents', async () => {
    const { service } = await seededService();
    const result = await service.search('germany');
    expect(result.total).toBe(2);
    const ids = result.hits.map((h) => h.document.id);
    expect(ids).toContain('u1');
    expect(ids).toContain('s1');
  });

  it('boosts exact title matches above content matches', async () => {
    const { service } = await seededService();
    const result = await service.search('DAAD Scholarship');
    expect(result.hits[0]?.document.id).toBe('s1');
  });

  it('applies type filters', async () => {
    const { service } = await seededService();
    const result = await service.search('daad', { type: 'forum_post' });
    expect(result.total).toBe(1);
    expect(result.hits[0]?.document.id).toBe('f1');
  });

  it('applies tag filters', async () => {
    const { service } = await seededService();
    const result = await service.search('germany', { tags: ['masters'] });
    expect(result.total).toBe(1);
    expect(result.hits[0]?.document.id).toBe('s1');
  });

  it('deletes documents from the index', async () => {
    const { service } = await seededService();
    await service.deleteDocument('scholarship', 's1');
    const result = await service.search('daad');
    expect(result.hits.map((h) => h.document.id)).not.toContain('s1');
  });

  it('records search logs and computes popular queries', async () => {
    const { service } = await seededService();
    await service.search('germany');
    await service.search('germany');
    await service.search('munich');

    const popular = await service.popularQueries();
    expect(popular[0]).toEqual({ query: 'germany', count: 2 });
  });

  it('rebuilds the index from a loader', async () => {
    const { service } = await seededService();
    const count = await service.rebuildIndex(async () => [
      doc({ id: 'c1', type: 'country', title: 'Germany', content: 'Country in Europe.' }),
    ]);
    expect(count).toBe(1);

    const old = await service.search('daad');
    expect(old.total).toBe(0);
    const fresh = await service.search('germany');
    expect(fresh.total).toBe(1);
    expect(fresh.hits[0]?.document.type).toBe('country');
  });
});
