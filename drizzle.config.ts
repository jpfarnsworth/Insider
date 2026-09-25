import { defineConfig } from 'drizzle-kit';

// Migrations run as the DDL-capable insider_migrator role, never insider_app
// (spec §6.0). Falls back to DATABASE_URL only for local experimentation.
const url = new URL((process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL)!);

// drizzle-kit only accepts an ssl option with host/port credentials, not a
// URL. Same policy as lib/db: SSL is required; the AWS server's certificate is
// self-signed, so chain verification is skipped unless DATABASE_SSL_CA is set.
const ca = process.env.DATABASE_SSL_CA;

export default defineConfig({
  schema: './db/schema',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ssl: ca ? { ca } : { rejectUnauthorized: false },
  },
});
