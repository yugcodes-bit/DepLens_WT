import type { Config } from 'drizzle-kit';

/**
 * Migrations are generated from `src/schema.ts` and committed, so a dataset release can always be
 * rebuilt from a known schema (doc 07 §10 reproducibility checklist).
 */
export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://deplens:deplens@localhost:5432/deplens' },
  strict: true,
} satisfies Config;
