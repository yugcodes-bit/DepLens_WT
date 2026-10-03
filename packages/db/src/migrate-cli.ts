#!/usr/bin/env node
/** Applies the committed migrations to whichever Postgres DATABASE_URL points at (doc 06 §7.4). */
import { closeDb, databaseUrl, migrate } from './client.ts';

const target = databaseUrl().replace(/:\/\/[^@]*@/, '://***@');
const ran = await migrate();
console.log(ran.length > 0 ? `applied ${ran.length} migration(s) on ${target}: ${ran.join(', ')}` : `already up to date on ${target}`);
await closeDb();
