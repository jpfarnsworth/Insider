import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@/db/schema';

// Web app: ~10 connections. Workers set DB_POOL_MAX=5 (spec §6.0).
// SSL is required by the server (sslmode=require in DATABASE_URL). node-postgres
// treats that as verify-full, and the AWS server's cert isn't in the system
// trust store, so encryption is enforced but chain verification is off unless
// DATABASE_SSL_CA is provided.
function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const parsed = new URL(url);
  parsed.searchParams.delete('sslmode');

  const ca = process.env.DATABASE_SSL_CA;
  return new Pool({
    connectionString: parsed.toString(),
    max: Number(process.env.DB_POOL_MAX ?? 10),
    ssl: ca ? { ca } : { rejectUnauthorized: false },
  });
}

// Reuse across Next.js dev hot reloads instead of leaking pools.
const globalForDb = globalThis as unknown as { __insiderPool?: Pool };

export const pool = (globalForDb.__insiderPool ??= createPool());
export const db = drizzle(pool, { schema });
export type Db = typeof db;
