import { describe, expect, it } from 'vitest';
import { chicagoToday, priorBusinessDays, weekdaysBetween, yearsBefore } from './dates';
import { dailyIndexUrl, normalizeCik, parseDailyIndex, parseSubmission } from './filings';
import { parseTickerFile } from './tickers';
import { easternToUtc } from './time';

describe('easternToUtc', () => {
  it('converts daylight time (EDT, UTC-4)', () => {
    expect(easternToUtc('20260923090007').toISOString()).toBe('2026-09-23T13:00:07.000Z');
  });

  it('converts standard time (EST, UTC-5)', () => {
    expect(easternToUtc('20260115090000').toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });

  it('handles the evening hours that push the UTC date forward', () => {
    expect(easternToUtc('20260923213000').toISOString()).toBe('2026-09-24T01:30:00.000Z');
  });

  it('gets the days around the DST changes right', () => {
    // Spring forward 2026-03-08 02:00, fall back 2026-11-01 02:00.
    expect(easternToUtc('20260307120000').toISOString()).toBe('2026-03-07T17:00:00.000Z');
    expect(easternToUtc('20260309120000').toISOString()).toBe('2026-03-09T16:00:00.000Z');
    expect(easternToUtc('20261031120000').toISOString()).toBe('2026-10-31T16:00:00.000Z');
    expect(easternToUtc('20261102120000').toISOString()).toBe('2026-11-02T17:00:00.000Z');
  });

  it('rejects malformed stamps and times that never happen', () => {
    expect(() => easternToUtc('2026-09-23')).toThrow(/Invalid EDGAR datetime/);
    expect(() => easternToUtc('20260308023000')).toThrow(/Not a real Eastern time/);
  });
});

describe('priorBusinessDays', () => {
  it('returns the previous weekdays, most recent first', () => {
    // 2026-09-24 is a Thursday.
    expect(priorBusinessDays('2026-09-24', 3)).toEqual(['20260923', '20260922', '20260921']);
  });

  it('skips weekends', () => {
    // 2026-09-21 is a Monday: prior days are Fri, Thu.
    expect(priorBusinessDays('2026-09-21', 2)).toEqual(['20260918', '20260917']);
    // A Sunday looks back to Friday.
    expect(priorBusinessDays('2026-09-20', 1)).toEqual(['20260918']);
  });

  it('crosses month and year boundaries', () => {
    expect(priorBusinessDays('2027-01-01', 1)).toEqual(['20261231']);
  });
});

describe('chicagoToday', () => {
  it('uses the Chicago calendar date, not UTC', () => {
    // 02:00 UTC on the 24th is still the evening of the 23rd in Chicago.
    expect(chicagoToday(new Date('2026-09-24T02:00:00Z'))).toBe('2026-09-23');
    expect(chicagoToday(new Date('2026-09-24T15:00:00Z'))).toBe('2026-09-24');
  });

  it('defaults to now', () => {
    expect(chicagoToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('normalizeCik', () => {
  it('pads to ten digits', () => {
    expect(normalizeCik('4977')).toBe('0000004977');
    expect(normalizeCik(320193)).toBe('0000320193');
    expect(normalizeCik(' 0000004977 ')).toBe('0000004977');
  });
});

describe('parseDailyIndex', () => {
  const index = [
    'Form Type   Company Name                                                  CIK         Date Filed  File Name',
    '---------------------------------------------------------------------------------------------------------',
    '1-A              Nomyx Technology Labs Inc.                                    2065495     20260923    edgar/data/2065495/0001683168-26-007327.txt',
    '4                AFLAC INC                                                     4977        20260923    edgar/data/4977/0001104659-26-109827.txt',
    '4                Japan Post Holdings Co., Ltd.                                 1783464     20260923    edgar/data/1783464/0001104659-26-109827.txt',
    '4/A              ATEX INC                                                      1234        20260923    edgar/data/1234/0001571601-26-000014.txt',
    '424B2            SOME BANK                                                     999         20260923    edgar/data/999/0000000000-26-000001.txt',
    '',
  ].join('\n');

  it('keeps only Forms 4 and 4/A, once per accession', () => {
    expect(parseDailyIndex(index)).toEqual([
      { form: '4', accession: '0001104659-26-109827', url: 'https://www.sec.gov/Archives/edgar/data/4977/0001104659-26-109827.txt' },
      { form: '4/A', accession: '0001571601-26-000014', url: 'https://www.sec.gov/Archives/edgar/data/1234/0001571601-26-000014.txt' },
    ]);
  });

  it('returns nothing for an empty index', () => {
    expect(parseDailyIndex('')).toEqual([]);
  });
});

describe('dailyIndexUrl', () => {
  it('picks the right quarter', () => {
    expect(dailyIndexUrl('20260923')).toBe('https://www.sec.gov/Archives/edgar/daily-index/2026/QTR3/form.20260923.idx');
    expect(dailyIndexUrl('20260105')).toContain('/2026/QTR1/');
    expect(dailyIndexUrl('20261231')).toContain('/2026/QTR4/');
  });
});

describe('parseSubmission', () => {
  const header = `<SEC-DOCUMENT>0001104659-26-109827.txt : 20260923
<SEC-HEADER>0001104659-26-109827.hdr.sgml : 20260923
<ACCEPTANCE-DATETIME>20260923090007
ACCESSION NUMBER:		0001104659-26-109827
CONFORMED SUBMISSION TYPE:	4
PUBLIC DOCUMENT COUNT:		1
CONFORMED PERIOD OF REPORT:	20260921
FILED AS OF DATE:		20260923
DATE AS OF CHANGE:		20260923

REPORTING-OWNER:

	OWNER DATA:
		COMPANY CONFORMED NAME:			Japan Post Holdings Co., Ltd.
		CENTRAL INDEX KEY:			0001783464

ISSUER:

	COMPANY DATA:
		COMPANY CONFORMED NAME:			AFLAC INC
		CENTRAL INDEX KEY:			0000004977
		STANDARD INDUSTRIAL CLASSIFICATION:	ACCIDENT & HEALTH INSURANCE [6321]
		ORGANIZATION NAME:           	02 Finance
</SEC-HEADER>`;
  const doc = '<?xml version="1.0"?><ownershipDocument><documentType>4</documentType></ownershipDocument>';

  it('reads the header and extracts the XML', () => {
    const s = parseSubmission(`${header}\n<DOCUMENT>\n<TYPE>4\n<XML>\n${doc}\n</XML>\n</DOCUMENT>\n</SEC-DOCUMENT>`);
    expect(s).toEqual({
      accession: '0001104659-26-109827',
      formType: '4',
      acceptedAt: new Date('2026-09-23T13:00:07Z'),
      filedAt: '2026-09-23',
      // The issuer, not the reporting owner listed first.
      issuer: { cik: '0000004977', name: 'AFLAC INC', industry: 'ACCIDENT & HEALTH INSURANCE' },
      xml: doc,
    });
  });

  it('returns null xml and null industry when they are absent', () => {
    const bare = header.replace(/\t\tSTANDARD INDUSTRIAL CLASSIFICATION:.*\n/, '');
    const s = parseSubmission(bare);
    expect(s.xml).toBeNull();
    expect(s.issuer.industry).toBeNull();
  });

  it('copes with a header that is never closed', () => {
    expect(parseSubmission(header.replace('</SEC-HEADER>', '')).issuer.name).toBe('AFLAC INC');
  });

  it('reads the issuer even when there is no ISSUER marker', () => {
    const noMarker = header.replace('ISSUER:', 'SOMETHING:');
    expect(parseSubmission(noMarker).accession).toBe('0001104659-26-109827');
  });

  it('rejects a header missing required fields', () => {
    expect(() => parseSubmission('<SEC-HEADER>nothing useful</SEC-HEADER>')).toThrow(/missing required fields/);
  });
});

describe('parseTickerFile', () => {
  it('maps CIKs to tickers and keeps the first row per company', () => {
    const entries = parseTickerFile({
      data: [
        [1652044, 'Alphabet Inc.', 'GOOGL', 'Nasdaq'],
        [320193, 'Apple Inc.', 'AAPL', 'Nasdaq'],
        [1652044, 'Alphabet Inc.', 'GOOG', 'Nasdaq'],
        [999, 'No Exchange Co', ' NEX ', null],
        ['888', 'No Ticker Co', null, 'NYSE'],
      ],
    });
    expect(entries).toEqual([
      { cik: '0001652044', name: 'Alphabet Inc.', ticker: 'GOOGL', exchange: 'Nasdaq' },
      { cik: '0000320193', name: 'Apple Inc.', ticker: 'AAPL', exchange: 'Nasdaq' },
      { cik: '0000000999', name: 'No Exchange Co', ticker: 'NEX', exchange: null },
    ]);
  });

  it('returns nothing when the file has no data', () => {
    expect(parseTickerFile({})).toEqual([]);
  });
});

describe('weekdaysBetween', () => {
  it('lists weekdays newest first, inclusive, skipping weekends', () => {
    // 2026-09-21 is a Monday.
    expect(weekdaysBetween('2026-09-18', '2026-09-22')).toEqual(['20260922', '20260921', '20260918']);
  });

  it('returns a single day when from equals to', () => {
    expect(weekdaysBetween('2026-09-23', '2026-09-23')).toEqual(['20260923']);
  });

  it('returns nothing for a weekend-only range', () => {
    expect(weekdaysBetween('2026-09-19', '2026-09-20')).toEqual([]);
  });
});

describe('yearsBefore', () => {
  it('subtracts calendar years', () => {
    expect(yearsBefore('2026-09-25', 2)).toBe('2024-09-25');
  });

  it('clamps Feb 29 to Feb 28', () => {
    expect(yearsBefore('2028-02-29', 1)).toBe('2027-02-28');
  });
});
