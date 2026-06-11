import type { SqlClient } from './client.js';
import { ALL_SCHEMAS } from './schema.js';

export type Migration = {
  id: string;
  up: (sql: SqlClient) => Promise<void>;
};

export const MIGRATIONS: Migration[] = [
  {
    id: '001-initial-schema',
    up: async (sql) => {
      for (const schema of ALL_SCHEMAS) {
        await sql.query(schema);
      }
    },
  },
];

export class MigrationRunner {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Run pending migrations.
   * Tracks applied migrations in the `_rota_migrations` table.
   * @param migrations List of migrations to run. Defaults to MIGRATIONS.
   * @returns Number of migrations applied.
   */
  async run(migrations: Migration[] = MIGRATIONS): Promise<number> {
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS _rota_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    let appliedCount = 0;
    for (const migration of migrations) {
      const result = await this.sql.query(
        `SELECT id FROM _rota_migrations WHERE id = $1`,
        [migration.id]
      );
      if (result.rows.length === 0) {
        // Run the migration
        await migration.up(this.sql);
        // Mark as applied
        await this.sql.query(
          `INSERT INTO _rota_migrations (id) VALUES ($1)`,
          [migration.id]
        );
        appliedCount += 1;
      }
    }
    return appliedCount;
  }
}
