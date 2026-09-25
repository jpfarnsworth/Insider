// Downloads real Form 4 filings from EDGAR into tests/fixtures, one per case
// the parser has to handle (spec §3.2). Run once, commit the results; tests
// never touch the network.
//
//   npm run fixtures:fetch -- 20260923 20260922
//
// Goes through the shared rate-limited EDGAR client and stops as soon as every
// case has its quota.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createEdgarClient, resolveUserAgent } from '@/lib/edgar/client';
import { isCommonStock, parseForm4, type ParsedForm4 } from '@/lib/form4';

// Rarest first: a filing is saved for the first unmet case it matches, so each
// file fills exactly one quota and the fixture set has that many distinct files.
const CASES: Array<{ name: string; quota: number; match: (p: ParsedForm4) => boolean }> = [
  { name: 'purchase-10b5-1', quota: 1, match: (p) => p.transactions.some((t) => t.code === 'P' && t.is10b5_1) },
  {
    name: 'footnote-price',
    quota: 1,
    // Price left blank and only described in a footnote ("weighted average price ...").
    match: (p) =>
      p.transactions.some(
        (t) => !t.isDerivative && t.price === null && t.footnotes.some((f) => /price|\$\s?\d/i.test(f)),
      ),
  },
  { name: 'purchase-qualifying', quota: 2, match: (p) => p.transactions.some((t) => t.isQualifying) },
  { name: 'amendment', quota: 2, match: (p) => p.documentType === '4/A' },
  {
    name: 'missing-price',
    quota: 1,
    match: (p) => p.transactions.some((t) => !t.isDerivative && t.price === null && t.footnotes.length === 0),
  },
  {
    name: 'non-common-security',
    quota: 1,
    match: (p) => p.transactions.some((t) => !t.isDerivative && !isCommonStock(t.securityTitle)),
  },
  {
    name: 'abbreviated-title',
    quota: 1,
    match: (p) => p.transactions.some((t) => /\bcomm\b|\bcom\b/i.test(t.securityTitle)),
  },
  { name: 'multiple-owners', quota: 2, match: (p) => p.owners.length > 1 },
  { name: 'indirect-ownership', quota: 1, match: (p) => p.transactions.some((t) => t.ownership === 'I') },
  {
    name: 'derivative-only',
    quota: 1,
    match: (p) => p.transactions.length > 0 && p.transactions.every((t) => t.isDerivative),
  },
  { name: 'flagged-10b5-1-sale', quota: 1, match: (p) => p.transactions.some((t) => t.code === 'S' && t.is10b5_1) },
  { name: 'sale', quota: 1, match: (p) => p.transactions.some((t) => t.code === 'S') },
  { name: 'grant', quota: 1, match: (p) => p.transactions.some((t) => t.code === 'A') },
  { name: 'option-exercise', quota: 1, match: (p) => p.transactions.some((t) => t.code === 'M') },
  { name: 'tax-withholding', quota: 1, match: (p) => p.transactions.some((t) => t.code === 'F') },
  { name: 'gift', quota: 1, match: (p) => p.transactions.some((t) => t.code === 'G') },
];

const MAX_FILINGS = 1200;
const OUT = path.join(process.cwd(), 'tests', 'fixtures');

async function main() {
  const dates = process.argv.slice(2);
  if (dates.length === 0 || dates.some((d) => !/^\d{8}$/.test(d))) {
    throw new Error('Usage: npm run fixtures:fetch -- YYYYMMDD [YYYYMMDD ...]');
  }

  const client = createEdgarClient({ userAgent: resolveUserAgent() });
  mkdirSync(OUT, { recursive: true });

  const filings: Array<{ accession: string; url: string; form: string }> = [];
  const seen = new Set<string>();
  for (const d of dates) {
    const quarter = Math.ceil(Number(d.slice(4, 6)) / 3);
    const idx = await client.getText(
      `https://www.sec.gov/Archives/edgar/daily-index/${d.slice(0, 4)}/QTR${quarter}/form.${d}.idx`,
    );
    for (const line of idx.split('\n')) {
      const m = /^(4|4\/A)\s.*?(edgar\/data\/\d+\/(\d{10}-\d{2}-\d{6})\.txt)/.exec(line);
      // Each filing is listed once per filer (issuer + each owner): dedupe.
      if (m && !seen.has(m[3])) {
        seen.add(m[3]);
        filings.push({ accession: m[3], url: `https://www.sec.gov/Archives/${m[2]}`, form: m[1] });
      }
    }
  }
  console.log(`${filings.length} unique filings in the index; scanning up to ${MAX_FILINGS}`);

  const counts = new Map(CASES.map((c) => [c.name, 0]));
  const manifest: Array<Record<string, unknown>> = [];
  let scanned = 0;
  let unparseable = 0;

  for (const f of filings.slice(0, MAX_FILINGS)) {
    if (CASES.every((c) => counts.get(c.name)! >= c.quota)) break;
    scanned++;

    let txt: string;
    try {
      txt = await client.getText(f.url);
    } catch (err) {
      console.warn(`skip ${f.accession}: ${(err as Error).message}`);
      continue;
    }
    const xml = /<XML>\s*([\s\S]*?)\s*<\/XML>/.exec(txt)?.[1];
    if (!xml) continue;
    const acceptedAt = /<ACCEPTANCE-DATETIME>(\d{14})/.exec(txt)?.[1] ?? null;

    let parsed: ParsedForm4 | null = null;
    let parseError: string | null = null;
    try {
      parsed = parseForm4(xml);
    } catch (err) {
      parseError = (err as Error).message;
    }

    // Real filings our parser rejects are the most valuable fixtures. Keep a couple.
    const name = parsed
      ? CASES.find((c) => counts.get(c.name)! < c.quota && c.match(parsed))?.name
      : unparseable < 2
        ? 'unparseable'
        : undefined;
    if (!name) continue;

    if (!parsed) unparseable++;
    else counts.set(name, counts.get(name)! + 1);

    const file = `${name}-${f.accession}.xml`;
    writeFileSync(path.join(OUT, file), xml + '\n');
    manifest.push({ file, accession: f.accession, form: f.form, acceptedAt, case: name, parseError });
    console.log(`saved ${file}${parseError ? `  (parse error: ${parseError})` : ''}`);
  }

  writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nscanned ${scanned}, saved ${manifest.length} fixtures`);
  const unmet = CASES.filter((c) => counts.get(c.name)! < c.quota).map((c) => `${c.name} (${counts.get(c.name)}/${c.quota})`);
  console.log(unmet.length ? `unmet cases: ${unmet.join(', ')}` : 'all cases covered');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
