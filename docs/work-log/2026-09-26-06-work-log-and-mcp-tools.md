# Work log folder and MCP tools to read it

Each finished piece of work now gets a short Markdown entry in `docs/work-log/`, and two new MCP tools let Claude Desktop read them, so you can ask it what has been built lately. The five entries above were written retroactively for this session.

## What changed
- `lib/worklog.ts`: lists entries newest first (title from the first heading, summary from the first paragraph) and reads one by name. Names must match `YYYY-MM-DD-NN-slug.md`; the reader resolves symlinks and refuses anything outside the folder or over 200 KB.
- MCP tools `list_work_log` (date, title, summary) and `read_work_log` (full Markdown), both read-only, in `lib/mcp/tools.ts`.
- CLAUDE.md rule: write an entry after each completed piece of work and commit it with the work. `docs/work-log/README.md` describes the format.
- `WORK_LOG_DIR` overrides the folder; the default is the repo's `docs/work-log`, which the app on the Pi can read because it runs from the checkout.

## Decisions
- Files in the repo, not database rows: they are reviewable in git and need no new table.
- Entries are treated as data by the tool description, never as instructions.

## Verified
- Unit tests for parsing, ordering, name validation, size limit and symlink escape; both tools exercised over the live MCP endpoint.
