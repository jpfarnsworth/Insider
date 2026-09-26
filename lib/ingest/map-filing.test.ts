import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Submission } from '@/lib/edgar/filings';
import { parseForm4 } from '@/lib/form4';
import { usableSymbol, mapFiling } from './map-filing';

const DIR = path.join(process.cwd(), 'tests', 'fixtures');
const manifest: Array<{ file: string; accession: string; form: string; case: string }> = JSON.parse(
  readFileSync(path.join(DIR, 'manifest.json'), 'utf8'),
);

function fixture(caseName: string, n = 0) {
  const entry = manifest.filter((m) => m.case === caseName)[n];
  const xml = readFileSync(path.join(DIR, entry.file), 'utf8');
  const sub: Submission = {
    accession: entry.accession,
    formType: entry.form,
    acceptedAt: new Date('2026-09-23T20:15:00Z'),
    filedAt: '2026-09-23',
    issuer: { cik: '0000999999', name: 'Header Issuer Name', industry: 'TEST INDUSTRY' },
    xml,
  };
  return { sub, xml, url: `https://www.sec.gov/Archives/edgar/data/1/${entry.accession}.txt` };
}

describe('mapFiling', () => {
  it('maps a parsed purchase to rows, with numbers as strings and 10-digit CIKs', () => {
    const { sub, xml, url } = fixture('purchase-qualifying');
    const parsed = parseForm4(xml);
    const m = mapFiling(url, sub, { parsed });

    expect(m.filing).toMatchObject({
      accessionNo: sub.accession,
      formType: '4',
      acceptedAt: sub.acceptedAt,
      filedAt: '2026-09-23',
      url,
      isAmendment: false,
      rawXml: xml,
      parseStatus: 'parsed',
      parseError: null,
    });
    expect(m.issuer.cik).toBe(m.filing.issuerCik);
    expect(m.issuer.cik).toMatch(/^\d{10}$/);
    expect(m.issuer.name).toBe(parsed.issuer.name);
    expect(m.issuer.industry).toBe('TEST INDUSTRY');
    expect(m.owners).toHaveLength(parsed.owners.length);
    expect(m.insiders.every((i) => /^\d{10}$/.test(i.cik))).toBe(true);

    const q = m.transactions.find((t) => t.isQualifying)!;
    expect(q.code).toBe('P');
    expect(typeof q.shares).toBe('string');
    expect(Number(q.price)).toBeGreaterThan(0);
    expect(q.issuerCik).toBe(m.issuer.cik);
  });

  it('attributes every transaction in a joint filing to the first owner', () => {
    const { sub, xml, url } = fixture('multiple-owners');
    const m = mapFiling(url, sub, { parsed: parseForm4(xml) });
    expect(m.owners.length).toBeGreaterThan(1);
    expect(m.transactions.length).toBeGreaterThan(0);
    expect(m.transactions.every((t) => t.insiderCik === m.owners[0].insiderCik)).toBe(true);
  });

  it('keeps null prices as null, not "null"', () => {
    const { sub, xml, url } = fixture('gift');
    const m = mapFiling(url, sub, { parsed: parseForm4(xml) });
    const gift = m.transactions.find((t) => t.code === 'G')!;
    expect(gift.price).toBeNull();
  });

  it('flags amendments and carries the original submission date', () => {
    const { sub, xml, url } = fixture('amendment');
    const m = mapFiling(url, sub, { parsed: parseForm4(xml) });
    expect(m.filing.isAmendment).toBe(true);
    expect(m.originalSubmissionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('stores a parse failure against the header issuer, with the error and raw XML', () => {
    const { sub, url } = fixture('sale');
    const m = mapFiling(url, sub, { error: 'Missing transaction date' });
    expect(m.filing).toMatchObject({
      issuerCik: '0000999999',
      parseStatus: 'failed',
      parseError: 'Missing transaction date',
      rawXml: sub.xml,
    });
    expect(m.issuer).toEqual({ cik: '0000999999', name: 'Header Issuer Name', industry: 'TEST INDUSTRY', symbol: null });
    expect(m.owners).toEqual([]);
    expect(m.transactions).toEqual([]);
    expect(m.insiders).toEqual([]);
    expect(m.originalSubmissionDate).toBeNull();
  });
});

describe('usableSymbol', () => {
  it('keeps plausible tickers, uppercased', () => {
    expect(usableSymbol('gme')).toBe('GME');
    expect(usableSymbol(' BRK-B ')).toBe('BRK-B');
    expect(usableSymbol('BRK.B')).toBe('BRK.B');
  });

  it('drops placeholders and junk', () => {
    for (const junk of ['NONE', 'none', 'N/A', 'NA', '[NONE]', '1314152', '', '  ', null, 'TOO LONG TICKER']) {
      expect(usableSymbol(junk)).toBeNull();
    }
  });
});
