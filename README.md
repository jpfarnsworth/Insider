# Insider Signals

Research platform that finds clusters of insider open-market purchases in SEC Form 4 filings, scores them, and
tracks their forward returns against a benchmark. No trading in Phase 1. Requirements: GitHub issue #1.

## Setup

1. `npm install`
2. `cp .env.local.example .env.local` and fill it in (see comments in the file). Generate `AUTH_SECRET` with
   `openssl rand -base64 32`.
3. Provision the databases and roles once, as an admin role on the Postgres server:

   ```bash
   psql "$ADMIN_DATABASE_URL" \
     -v app_pw="$INSIDER_APP_PASSWORD" -v migrator_pw="$INSIDER_MIGRATOR_PASSWORD" \
     -f db/setup-roles.sql
   ```

   Then put the two passwords into `DATABASE_URL` (`insider_app`) and `DATABASE_MIGRATOR_URL` (`insider_migrator`).
4. Restrict port 5432 on the AWS security group to this machine's IP and the prod server. Never `0.0.0.0/0`.
5. `npm run db:migrate`
6. `npm run dev` and open http://localhost:3040. Sign in with the address set in `ALLOWED_EMAIL`.

## Scripts

See `CLAUDE.md` for the full list. Common ones: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.

## Disclaimer

Personal research tool. Nothing it produces is investment advice.
