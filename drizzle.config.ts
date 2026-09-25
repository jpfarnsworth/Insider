import { defineConfig } from 'drizzle-kit';

// Migrations run as the DDL-capable insider_migrator role, never insider_app
// (spec §6.0). Falls back to DATABASE_URL only for local experimentation.
export default defineConfig({
  schema: './db/schema',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: (process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL)!,
  },
});
