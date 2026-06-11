import type { SqlClient } from './client.js';

export * from './client.js';
export * from './schema.js';
export * from './migrations.js';

import { MigrationRunner } from './migrations.js';

/**
 * @deprecated Use `new MigrationRunner(client).run()` instead.
 * Apply all Rota Core schemas to a PostgreSQL database. Idempotent.
 */
export async function applySchema(client: SqlClient): Promise<void> {
  const runner = new MigrationRunner(client);
  await runner.run();
}
