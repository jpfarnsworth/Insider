import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

// The work log: one Markdown file per finished piece of work, written after it is done (see CLAUDE.md).
// Files are named YYYY-MM-DD-NN-slug.md; the first `# ` heading is the title and the first paragraph
// under it is the summary. The MCP tools read this folder so Claude Desktop can be told what was built.
export const WORK_LOG_DIR = process.env.WORK_LOG_DIR ?? path.join(process.cwd(), 'docs', 'work-log');

/** Only plain dated .md file names: no paths, no dots but the extension, so a name can't escape the folder. */
export const ENTRY_NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/;

export const MAX_ENTRY_BYTES = 200_000;
const SUMMARY_CHARS = 280;

export interface WorkLogEntry {
  name: string;
  date: string;
  title: string;
  summary: string;
}

/** Title, date and one-paragraph summary from a file's name and text. */
export function parseEntry(name: string, content: string): WorkLogEntry {
  const lines = content.split(/\r?\n/);
  const titleIdx = lines.findIndex((l) => /^#\s+\S/.test(l));
  const title = titleIdx >= 0 ? lines[titleIdx].replace(/^#\s+/, '').trim() : name.replace(/\.md$/, '');
  const paragraph: string[] = [];
  for (const line of lines.slice(titleIdx + 1)) {
    if (/^#{1,6}\s/.test(line)) break; // the summary is the text before the next heading
    if (line.trim() === '') {
      if (paragraph.length) break;
      continue;
    }
    paragraph.push(line.trim());
  }
  const summary = paragraph.join(' ');
  return { name, date: name.slice(0, 10), title, summary: summary.length > SUMMARY_CHARS ? `${summary.slice(0, SUMMARY_CHARS - 1)}…` : summary };
}

/** Entries newest first (by file name, which starts with the date and a sequence number). */
export async function listEntries(dir: string = WORK_LOG_DIR): Promise<WorkLogEntry[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return []; // no folder yet is an empty log, not an error
  }
  const entries = await Promise.all(
    names
      .filter((n) => ENTRY_NAME.test(n))
      .map(async (n) => {
        const r = await readEntry(n, dir);
        return r.ok ? parseEntry(n, r.content.slice(0, 4000)) : null; // unreadable entries (escaping symlinks, oversized) are not listed
      }),
  );
  return entries.filter((e): e is WorkLogEntry => e !== null).sort((a, b) => b.name.localeCompare(a.name));
}

export type ReadResult = { ok: true; content: string } | { ok: false; error: string };

export async function readEntry(name: string, dir: string = WORK_LOG_DIR): Promise<ReadResult> {
  if (!ENTRY_NAME.test(name)) return { ok: false, error: 'Not a work-log file name. Use a name from list_work_log.' };
  const file = path.join(dir, name);
  try {
    // Resolve symlinks: a valid-looking name must still be a file that lives inside the folder.
    const [real, root] = await Promise.all([realpath(file), realpath(dir)]);
    if (path.dirname(real) !== root) return { ok: false, error: 'Entry is not readable.' };
    const info = await stat(real);
    if (!info.isFile() || info.size > MAX_ENTRY_BYTES) return { ok: false, error: 'Entry is not readable.' };
    return { ok: true, content: await readFile(real, 'utf8') };
  } catch {
    return { ok: false, error: 'No such entry.' };
  }
}
