/**
 * Database connection (doc 06 §2: PostgreSQL 16 + Drizzle).
 *
 * The harness deliberately does not depend on this package: it must be able to measure with nothing
 * but a disk (see `packages/harness/src/store.ts`). The campaign runner, API and workers use it to
 * promote stored sessions into the dataset.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

export type DepLensDb = NodePgDatabase<typeof schema>;

export const DEFAULT_URL = 'postgres://deplens:deplens@localhost:5432/deplens';

let pool: Pool | null = null;

/** Lazily creates one pool per process; call `closeDb()` in scripts so they can exit. */
export function getDb(connectionString = process.env.DATABASE_URL ?? DEFAULT_URL): DepLensDb {
  pool ??= new Pool({ connectionString, max: Number(process.env.DEPLENS_DB_POOL ?? 10) });
  return drizzle(pool, { schema });
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}
