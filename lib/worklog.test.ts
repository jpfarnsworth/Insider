import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENTRY_NAME, listEntries, parseEntry, readEntry } from './worklog';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'worklog-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('parseEntry', () => {
  it('takes the title, date and the paragraph before the next heading', () => {
    const e = parseEntry('2026-09-26-01-thing.md', '# Add the thing\n\nBuilt a thing\nacross two lines.\n\nMore text.\n\n## Details\nignored');
    expect(e).toEqual({ name: '2026-09-26-01-thing.md', date: '2026-09-26', title: 'Add the thing', summary: 'Built a thing across two lines.' });
  });

  it('falls back to the file name and truncates long summaries', () => {
    expect(parseEntry('2026-09-26-02-x.md', 'no heading here').title).toBe('2026-09-26-02-x');
    const long = parseEntry('2026-09-26-03-y.md', `# T\n\n${'word '.repeat(200)}`);
    expect(long.summary.length).toBeLessThanOrEqual(280);
    expect(long.summary.endsWith('…')).toBe(true);
  });

  it('has an empty summary when a heading follows the title directly', () => {
    expect(parseEntry('2026-09-26-04-z.md', '# T\n## Next\ntext').summary).toBe('');
  });
});

describe('file names', () => {
  it('accepts dated slugs only', () => {
    for (const ok of ['2026-09-26-01-thing.md', '2026-09-26-a.md']) expect(ENTRY_NAME.test(ok)).toBe(true);
    for (const bad of ['../x.md', '2026-09-26-01-thing.txt', 'notes.md', '2026-09-26-.md', '2026-09-26-a/b.md', '2026-09-26-A.md', '.2026-09-26-a.md']) {
      expect(ENTRY_NAME.test(bad)).toBe(false);
    }
  });
});

describe('listEntries / readEntry', () => {
  it('lists newest first, ignoring other files, and an absent folder is empty', async () => {
    await writeFile(path.join(dir, '2026-09-25-01-old.md'), '# Old\n\nolder work');
    await writeFile(path.join(dir, '2026-09-26-02-new.md'), '# New\n\nnewer work');
    await writeFile(path.join(dir, '2026-09-26-01-mid.md'), '# Mid\n\nmiddle');
    await writeFile(path.join(dir, 'README.md'), '# Readme');
    expect((await listEntries(dir)).map((e) => e.title)).toEqual(['New', 'Mid', 'Old']);
    expect(await listEntries(path.join(dir, 'missing'))).toEqual([]);
  });

  it('reads an entry, and refuses bad names, missing files and oversized ones', async () => {
    await writeFile(path.join(dir, '2026-09-26-01-a.md'), '# A\n\nbody');
    expect(await readEntry('2026-09-26-01-a.md', dir)).toEqual({ ok: true, content: '# A\n\nbody' });
    expect(await readEntry('../secret.md', dir)).toMatchObject({ ok: false });
    expect(await readEntry('2026-09-26-99-none.md', dir)).toMatchObject({ ok: false });
    await writeFile(path.join(dir, '2026-09-26-02-big.md'), 'x'.repeat(200_001));
    expect(await readEntry('2026-09-26-02-big.md', dir)).toMatchObject({ ok: false });
  });

  it('refuses a symlink that points outside the folder', async () => {
    const outside = path.join(dir, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'secret.md'), '# secret');
    await symlink(path.join(outside, 'secret.md'), path.join(dir, '2026-09-26-01-link.md'));
    expect(await readEntry('2026-09-26-01-link.md', dir)).toMatchObject({ ok: false });
    expect(await listEntries(dir)).toEqual([]);
  });
});
