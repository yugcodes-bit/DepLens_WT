#!/usr/bin/env node
/**
 * Local Postgres for development, with nothing to install (doc 06 §7.4).
 *
 * Runs PGlite — real Postgres 16 compiled to WebAssembly — behind a **Postgres wire-protocol
 * socket**, so everything else in the repo connects with an ordinary `DATABASE_URL` and the normal
 * `pg` driver. Production points the same variable at Neon and nothing else changes.
 *
 * Why a socket server rather than embedding PGlite in the web app: PGlite's WASM loader breaks inside
 * Next.js's server runtime (Next's `URL` shim is not the one `node:fs` recognises). Speaking the wire
 * protocol keeps the app's database code identical in dev and production, which is the point — a dev
 * setup that exercises a different driver is a dev setup that hides bugs.
 *
 * Usage:  pnpm --filter @deplens/db serve        (then set DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres)
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { mkdir } from 'node:fs/promises';
import { PGLITE_DIR } from './client.ts';

const port = Number(process.env.DEPLENS_PG_PORT ?? 5432);
const host = process.env.DEPLENS_PG_HOST ?? '127.0.0.1';

await mkdir(PGLITE_DIR, { recursive: true });
const pglite = await PGlite.create(PGLITE_DIR);
const server = new PGLiteSocketServer({ db: pglite, port, host });
await server.start();

console.log(`PGlite listening on postgres://postgres@${host}:${port}/postgres`);
console.log(`  data dir: ${PGLITE_DIR}`);
console.log('  set DATABASE_URL to that connection string, then run: pnpm --filter @deplens/db migrate:local');
console.log('  stop with Ctrl+C');

const shutdown = async () => {
  await server.stop();
  await pglite.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
