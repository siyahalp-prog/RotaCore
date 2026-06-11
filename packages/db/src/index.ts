import type { SqlClient } from './client.js';
import { ALL_SCHEMAS } from './schema.js';

export * from './client.js';
export * from './schema.js';

/** Apply all Rota Core schemas to a PostgreSQL database. Idempotent. */
export async function applySchema(client: SqlClient): Promise<void> {
  for (const schema of ALL_SCHEMAS) {
    await client.query(schema);
  }
}
