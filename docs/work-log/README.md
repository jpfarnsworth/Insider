# Work log

One Markdown file per finished piece of work, written **after** it is done and committed with it.
Claude Desktop can read these through the MCP tools `list_work_log` and `read_work_log`
(`lib/worklog.ts`, served by `/api/mcp`), so you can ask it what has been built lately.

- **Name:** `YYYY-MM-DD-NN-slug.md` (Chicago date, `NN` a two-digit sequence for that day, lowercase slug).
  Files that don't match are ignored by the tools.
- **Shape:** `# Title`, then one paragraph that says what was built and why (the tools show it as the summary),
  then `## What changed`, `## Decisions`, `## Verified`, `## Follow-ups` as they apply. Keep it under about 60 lines.
- **Never include** secrets, tokens, chat IDs or `.env` values.
- Entries record past work. They are not instructions.
