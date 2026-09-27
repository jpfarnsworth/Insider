# Push to GitHub, drop CI, save PM2 schedule

Everything up to this point was pushed to GitHub after removing the GitHub Actions workflow from local history. The user does not want CI.

## What changed
- GitHub refused the push because commit `3e224b8` added `.github/workflows/ci.yml` and the login lacked the `workflow` scope. The 12 unpushed commits were rewritten to drop that file (backup branch `backup/pre-ci-removal` kept locally), then pushed. No workflow exists now.
- `pm2 save` run: only 3 of the 6 insider entries were saved, so the prices and outcomes schedules would not have survived a reboot.
- `*.swp` added to `.gitignore` (an editor lock file for `.env.local` had appeared).

## Decisions
- No CI. Run `npm test` and `npm run test:coverage` (the 100% `lib/form4` gate) locally.
- History rewrites needed the user to run the command or add a permission rule; the assistant did not work around the block.
