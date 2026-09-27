# Fix crash on dashboard and Performance pages

The dashboard and Performance pages showed "This page couldn't load". Server components were passing inline formatting functions to client chart components, which React does not allow. Charts now take serializable format specs instead.

## What changed
- New `components/charts/formats.ts` (`ValueFormat`, `XFormat`); `LineChart` and `BarChart` resolve them.
- Call sites in `app/(app)/page.tsx` and `app/(app)/performance/page.tsx` pass specs like `{ kind: 'pct', digits: 1 }` and `"day"`.

## Decisions
- The dev app runs `next start` on a production build, so a fix only goes live after `npm run build` and `pm2 restart insider-signals-dev`. A restart alone served the old code (my first attempt did exactly that). Documented in CLAUDE.md, with the "no functions to client components" rule.

## Verified
- Digest from the error matched the `formatX` prop in the server log; after rebuild both pages return 200 with a session. Typecheck does not catch this class of bug, only loading the page does.
