# Sticky sidebar

The side menu now stays in view while the main page scrolls. On `md` and wider screens the sidebar in
`app/(app)/layout.tsx` is pinned to the top at full viewport height; on mobile, where the nav is a horizontal
strip, nothing changed.

## What changed

- `app/(app)/layout.tsx`: the `<aside>` gained `md:sticky md:top-0 md:h-screen md:self-start md:overflow-y-auto`.

## Decisions

- `self-start` is needed so the aside isn't stretched to the full height of the flex row, which would defeat
  `sticky`. `overflow-y-auto` lets the nav scroll internally if it is ever taller than the viewport.

## Verified

- `npm run build` succeeded and `insider-signals-dev` was restarted (online). Not checked visually in a browser.

## Follow-ups

- None.
