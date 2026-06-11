/**
 * Minimal SQL client abstraction.
 * Any PostgreSQL driver (pg, postgres.js, Neon, etc.) can be adapted to this
 * interface, keeping Rota Core packages free of a hard driver dependency.
 */
export type SqlQueryResult<T = Record<string, unknown>> = {
  rows: T[];
  rowCount?: number;
};

export type SqlClient = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlQueryResult<T>>;
};
