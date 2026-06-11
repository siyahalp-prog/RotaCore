import { describe, expect, it } from 'vitest';
import { MigrationRunner } from '../src/index.js';
import type { SqlClient } from '../src/client.js';

class MockSqlClient implements SqlClient {
  public queries: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public results: { rows: any[]; rowCount: number }[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query<T = any>(sql: string, _params?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push(sql.trim());
    const nextResult = this.results.shift();
    return nextResult ?? { rows: [], rowCount: 0 };
  }
}

describe('MigrationRunner', () => {
  it('creates tracking table and runs pending migrations', async () => {
    const client = new MockSqlClient();
    // 1. Result for CREATE TABLE IF NOT EXISTS
    client.results.push({ rows: [], rowCount: 0 });
    // 2. The SELECT check for whether migration is applied returns 0 rows
    client.results.push({ rows: [], rowCount: 0 });

    const runner = new MigrationRunner(client);
    let called = false;
    const migrations = [
      {
        id: 'test-1',
        up: async () => {
          called = true;
        },
      },
    ];

    const count = await runner.run(migrations);

    expect(count).toBe(1);
    expect(called).toBe(true);
    expect(client.queries[0]).toContain('CREATE TABLE IF NOT EXISTS _rota_migrations');
    expect(client.queries[1]).toContain('SELECT id FROM _rota_migrations WHERE id = $1');
    expect(client.queries[2]).toContain('INSERT INTO _rota_migrations (id) VALUES ($1)');
  });

  it('skips already applied migrations', async () => {
    const client = new MockSqlClient();
    // 1. Result for CREATE TABLE IF NOT EXISTS
    client.results.push({ rows: [], rowCount: 0 });
    // 2. The SELECT check returns 1 row indicating it is already applied
    client.results.push({ rows: [{ id: 'test-1' }], rowCount: 1 });

    const runner = new MigrationRunner(client);
    let called = false;
    const migrations = [
      {
        id: 'test-1',
        up: async () => {
          called = true;
        },
      },
    ];

    const count = await runner.run(migrations);

    expect(count).toBe(0);
    expect(called).toBe(false);
    expect(client.queries[0]).toContain('CREATE TABLE IF NOT EXISTS _rota_migrations');
    expect(client.queries[1]).toContain('SELECT id FROM _rota_migrations WHERE id = $1');
    // It should not run the INSERT since it skipped the migration
    expect(client.queries.length).toBe(2);
  });
});
