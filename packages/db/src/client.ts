/**
 * Database connection (doc 06 §2, §7.4).
 *
 * **One driver, everywhere.** The app always talks to a real Postgres over the wire with
 * `node-postgres`, whether that is Neon in production or the local PGlite socket server in
 * development (`pnpm db:serve`). A dev setup that used a different driver would be a dev setup that
 * hides bugs, so the only difference between environments is the value of `DATABASE_URL`.
 *
 * The harness deliberately does not depend on this package: it must be able to measure with nothing
 * but a disk (`packages/harness/src/store.ts`). The web app, API and workers use it.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as schema from './schema.ts';

export type DepLensDb = NodePgDatabase<typeof schema>;

/** Where the local PGlite server keeps its data (see `serve-cli.ts`). */
export const PGLITE_DIR = process.env.DEPLENS_PGLITE_DIR ?? resolve(process.cwd(), '.work/pglite');

/** Connection string for the local development server started by `pnpm db:serve`. */
export const LOCAL_URL = `postgres://postgres@127.0.0.1:${process.env.DEPLENS_PG_PORT ?? 5432}/postgres`;

let db: DepLensDb | null = null;
let pool: Pool | null = null;

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  // Defaulting beats throwing here: a fresh clone runs `pnpm db:serve` and works with no .env at all.
  return LOCAL_URL;
}

/**
 * The process-wide database handle. Safe to call per request — Next.js route handlers do, and the
 * same pool is reused.
 */
/** True when `DATABASE_URL` points at the local PGlite socket server rather than a real server. */
export function isLocalPglite(url = databaseUrl()): boolean {
  return url === LOCAL_URL || /^postgres:\/\/postgres@(127\.0\.0\.1|localhost)(:\d+)?\/postgres$/.test(url);
}

export function getDb(): DepLensDb {
  if (db) return db;
  const url = databaseUrl();
  pool = new Pool({
    connectionString: url,
    // The local PGlite socket server wraps a single WASM Postgres and serves one connection at a
    // time — a larger pool gets ECONNRESET on the extra clients. Neon's pooled endpoint plus
    // serverless functions means many short-lived clients, so keep that small too.
    max: Number(process.env.DEPLENS_DB_POOL ?? (isLocalPglite(url) ? 1 : 5)),
    ...(url.includes('neon.tech') ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  db = drizzle(pool, { schema });
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
}

/** Statements in a generated Drizzle migration file, in order. */
async function migrationStatements(migrationsDir: string): Promise<{ file: string; statements: string[] }[]> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const out: { file: string; statements: string[] }[] = [];
  for (const file of files) {
    const text = await readFile(join(migrationsDir, file), 'utf8');
    out.push({
      file,
      statements: text
        .split('--> statement-breakpoint')
        .map((st) => st.trim())
        .filter((st) => st.length > 0),
    });
  }
  return out;
}

/**
 * Applies the committed migrations, recording which files have run in `_deplens_migration`.
 * Idempotent, so it is safe to run on every deploy.
 */
export async function migrate(migrationsDir = resolve(import.meta.dirname, '../migrations')): Promise<string[]> {
  const d = getDb();
  await d.execute(sql`create table if not exists "_deplens_migration" (
    "file" text primary key,
    "applied_at" timestamptz not null default now()
  )`);
  const existing = await d.execute(sql`select "file" from "_deplens_migration"`);
  const applied = new Set((existing.rows as { file: string }[]).map((r) => r.file));

  const ran: string[] = [];
  for (const { file, statements } of await migrationStatements(migrationsDir)) {
    if (applied.has(file)) continue;
    for (const statement of statements) await d.execute(sql.raw(statement));
    await d.execute(sql`insert into "_deplens_migration" ("file") values (${file})`);
    ran.push(file);
  }
  return ran;
}
