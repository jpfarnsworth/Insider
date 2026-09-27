# Milestone 8: settings, search, export, saved filters, Telegram alerts

Built the spec's "polish" milestone: an editable Settings page with numbered versions and a preview-impact button, a Ctrl/Cmd+K search, a filterable signals list with CSV export and saved presets, and Telegram alerts for failed jobs and high-score signals. Deploy stays on the Pi (no AWS).

## What changed
- **Settings** (`/settings`): cluster rule, baseline weights, costs, default benchmark, agent limits, feature flags, notifications. Saves go through `saveSetting` (`lib/settings.ts`): Zod-validated, and each real change appends a row to `setting_versions`. `clusters.rule_revision` and `signals.baseline_revision` record which revision produced them. Saving never rewrites history; "Re-score all signals" is an explicit button.
- **Preview impact** (`previewClusterRule`): runs detection in memory and compares per company (per-signal add/drop counts mislead, because a looser rule fires earlier on the same buying). About 30 seconds on the Pi.
- **Signals list**: filters in `lib/signals/filters.ts` (pure, tested), 5/30/90-day net excess columns, CSV at `/signals/export` (formula-injection safe), saved presets (`saved_filters`). No market-cap or sector filter: no data source.
- **Search**: `lib/search.ts` behind `/api/search` (ticker, company, insider, accession number).
- **Notifications**: send-only Telegram bot (its own bot, `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`). `alert-signals` job alerts once per signal (`signals.alerted_at`) when either score reaches the threshold (default 70), only for signals under 3 days old. Job failures notify from `runJob`.

## Decisions
- Telegram over email/webhook (user's choice, like the Tasks and Life OS bots). Alert rule: agent or baseline score at or above a threshold.
- Forms submit through `onSubmit` + a transition, because React 19 resets uncontrolled fields after a form action, which threw away the edits being previewed.

## Verified
- Versioning, preview, search and the alert no-op path against the dev database; pages and interactive parts in a browser; a real Telegram test message arrived.
