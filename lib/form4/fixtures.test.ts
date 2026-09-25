import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCommonStock, parseForm4, type ParsedForm4 } from './index';

// Real filings from EDGAR, chosen by scripts/fetch-fixtures.ts.
const DIR = path.join(process.cwd(), 'tests', 'fixtures');
const manifest: Array<{ file: string; accession: string; case: string; acceptedAt: string | null }> = JSON.parse(
  readFileSync(path.join(DIR, 'manifest.json'), 'utf8'),
);

function load(caseName: string, n = 0): ParsedForm4 {
  const entry = manifest.filter((m) => m.case === caseName)[n];
  if (!entry) throw new Error(`no fixture for ${caseName}[${n}]`);
  return parseForm4(readFileSync(path.join(DIR, entry.file), 'utf8'));
}

describe('real EDGAR fixtures', () => {
  it('has at least 15 fixtures and the manifest matches the files on disk', () => {
    const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.xml')).sort();
    expect(onDisk.length).toBeGreaterThanOrEqual(15);
    expect(manifest.map((m) => m.file).sort()).toEqual(onDisk);
  });

  it('parses every fixture, with an issuer, an owner and acceptance metadata', () => {
    for (const m of manifest) {
      const p = parseForm4(readFileSync(path.join(DIR, m.file), 'utf8'));
      expect(p.issuer.cik, m.file).toMatch(/^\d+$/);
      expect(p.owners.length, m.file).toBeGreaterThan(0);
      expect(m.acceptedAt, m.file).toMatch(/^\d{14}$/);
    }
  });

  it('only marks common-stock open-market purchases with a price as qualifying', () => {
    for (const m of manifest) {
      const p = parseForm4(readFileSync(path.join(DIR, m.file), 'utf8'));
      for (const t of p.transactions.filter((x) => x.isQualifying)) {
        expect(t, m.file).toMatchObject({ code: 'P', acquiredDisposed: 'A', isDerivative: false, is10b5_1: false });
        expect(t.price, m.file).toBeGreaterThan(0);
        expect(isCommonStock(t.securityTitle), m.file).toBe(true);
      }
    }
  });

  it('finds qualifying purchases in plain open-market buys', () => {
    for (const n of [0, 1]) {
      const p = load('purchase-qualifying', n);
      expect(p.transactions.filter((t) => t.isQualifying)).toHaveLength(1);
    }
  });

  it('does not qualify a purchase made under a 10b5-1 plan', () => {
    const p = load('purchase-10b5-1');
    const purchase = p.transactions.find((t) => t.code === 'P')!;
    expect(purchase.is10b5_1).toBe(true);
    expect(purchase.price).toBeGreaterThan(0);
    expect(purchase.isQualifying).toBe(false);
  });

  it('flags 10b5-1 sales', () => {
    expect(load('flagged-10b5-1-sale').transactions.some((t) => t.code === 'S' && t.is10b5_1)).toBe(true);
  });

  it('handles joint filings with several reporting owners', () => {
    expect(load('multiple-owners', 0).owners.length).toBeGreaterThan(1);
    expect(load('multiple-owners', 1).owners.length).toBeGreaterThan(1);
  });

  it('records indirect ownership', () => {
    expect(load('indirect-ownership').transactions.every((t) => t.ownership === 'I')).toBe(true);
  });

  it('links a 4/A to the date of the original submission', () => {
    for (const n of [0, 1]) {
      const p = load('amendment', n);
      expect(p.documentType).toBe('4/A');
      expect(p.dateOfOriginalSubmission).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('keeps a price that is only described in a footnote as null, with the footnote text', () => {
    const t = load('footnote-price').transactions.find((x) => x.price === null && x.footnotes.length > 0)!;
    expect(t.isQualifying).toBe(false);
    expect(t.footnotes.some((f) => /price|\$\s?\d/i.test(f))).toBe(true);
  });

  it('handles derivative-only filings', () => {
    const p = load('derivative-only');
    expect(p.transactions.length).toBeGreaterThan(0);
    expect(p.transactions.every((t) => t.isDerivative && !t.isQualifying)).toBe(true);
  });

  it('never qualifies non-common securities', () => {
    const p = load('non-common-security');
    const odd = p.transactions.filter((t) => !t.isDerivative && !isCommonStock(t.securityTitle));
    expect(odd.length).toBeGreaterThan(0);
    expect(odd.every((t) => !t.isQualifying)).toBe(true);
  });

  it('recognises abbreviated common-stock titles ("Comm Stock")', () => {
    const p = load('abbreviated-title');
    expect(p.transactions.some((t) => /\bcomm\b|\bcom\b/i.test(t.securityTitle) && isCommonStock(t.securityTitle))).toBe(true);
  });

  it('keeps other transaction codes: sale, grant, exercise, tax withholding, gift', () => {
    const codes = (name: string) => new Set(load(name).transactions.map((t) => t.code));
    expect(codes('sale').has('S')).toBe(true);
    expect(codes('grant').has('A')).toBe(true);
    expect(codes('option-exercise').has('M')).toBe(true);
    expect(codes('tax-withholding').has('F')).toBe(true);
    expect(codes('gift').has('G')).toBe(true);
  });

  it('keeps a gift with no price as null instead of failing', () => {
    const gift = load('gift').transactions.find((t) => t.code === 'G')!;
    expect(gift.price).toBeNull();
    expect(gift.isQualifying).toBe(false);
  });
});
