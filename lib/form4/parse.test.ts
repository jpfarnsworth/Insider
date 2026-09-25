import { describe, expect, it } from 'vitest';
import { deriv, form4, nd, owner } from '@/tests/form4-builder';
import { Form4ParseError, parseForm4 } from './index';

describe('parseForm4: basics', () => {
  it('parses a simple open-market purchase', () => {
    const p = parseForm4(form4());
    expect(p.documentType).toBe('4');
    expect(p.periodOfReport).toBe('2024-01-02');
    expect(p.dateOfOriginalSubmission).toBeNull();
    expect(p.issuer).toEqual({ cik: '0000123456', name: 'Acme Corp', tradingSymbol: 'ACME' });
    expect(p.owners).toEqual([
      {
        cik: '0001111111',
        name: 'Doe John',
        isDirector: false,
        isOfficer: false,
        officerTitle: null,
        isTenPctOwner: false,
        isOther: false,
      },
    ]);
    expect(p.transactions).toEqual([
      {
        securityTitle: 'Common Stock',
        isDerivative: false,
        transactionDate: '2024-01-02',
        code: 'P',
        shares: 1000,
        price: 10.5,
        acquiredDisposed: 'A',
        sharesOwnedAfter: 5000,
        ownership: 'D',
        is10b5_1: false,
        footnotes: [],
        isQualifying: true,
      },
    ]);
  });

  it('keeps CIKs as strings with their leading zeros', () => {
    expect(parseForm4(form4()).issuer.cik).toBe('0000123456');
  });

  it('parses several reporting owners with relationship flags', () => {
    const p = parseForm4(
      form4({
        owners: [
          owner({ cik: '1', name: 'A', officer: '1', director: 'true', title: 'Chief Executive Officer' }),
          owner({ cik: '2', name: 'B', tenPct: '1', other: 'TRUE' }),
        ],
      }),
    );
    expect(p.owners).toHaveLength(2);
    expect(p.owners[0]).toMatchObject({ isDirector: true, isOfficer: true, officerTitle: 'Chief Executive Officer' });
    expect(p.owners[1]).toMatchObject({ isTenPctOwner: true, isOther: true, officerTitle: null });
  });

  it('treats a missing relationship block as no relationships', () => {
    const xml = form4({
      owners: [
        '<reportingOwner><reportingOwnerId><rptOwnerCik>9</rptOwnerCik><rptOwnerName>X</rptOwnerName></reportingOwnerId></reportingOwner>',
      ],
    });
    expect(parseForm4(xml).owners[0]).toMatchObject({ isDirector: false, isOfficer: false });
  });

  it('reports indirect ownership', () => {
    expect(parseForm4(form4({ nonDerivative: [nd({ own: 'I' })] })).transactions[0].ownership).toBe('I');
  });

  it('returns null for unknown or missing acquired/disposed and ownership codes', () => {
    const [t] = parseForm4(form4({ nonDerivative: [nd({ ad: 'X', own: null })] })).transactions;
    expect(t.acquiredDisposed).toBeNull();
    expect(t.ownership).toBeNull();
    const [u] = parseForm4(form4({ nonDerivative: [nd({ ad: null, own: 'Z' })] })).transactions;
    expect(u.acquiredDisposed).toBeNull();
    expect(u.ownership).toBeNull();
  });

  it('handles a sale', () => {
    const [t] = parseForm4(form4({ nonDerivative: [nd({ code: 'S', ad: 'D' })] })).transactions;
    expect(t).toMatchObject({ code: 'S', acquiredDisposed: 'D', isQualifying: false });
  });

  it('leaves the trading symbol and period of report null when absent', () => {
    const p = parseForm4(form4({ symbol: null, period: null }));
    expect(p.issuer.tradingSymbol).toBeNull();
    expect(p.periodOfReport).toBeNull();
  });

  it('treats an empty element the same as a missing one', () => {
    expect(parseForm4(form4({ symbol: '' })).issuer.tradingSymbol).toBeNull();
  });

  it('parses several transactions in one filing', () => {
    const p = parseForm4(form4({ nonDerivative: [nd({ shares: '10' }), nd({ shares: '20' })] }));
    expect(p.transactions.map((t) => t.shares)).toEqual([10, 20]);
  });

  it('handles empty or absent transaction tables', () => {
    expect(parseForm4(form4({ nonDerivative: [] })).transactions).toEqual([]);
    expect(parseForm4(form4({ nonDerivative: null })).transactions).toEqual([]);
  });

  it('ignores holdings that are not transactions', () => {
    const xml = form4({
      nonDerivative: [],
      rawBody:
        '<nonDerivativeTable><nonDerivativeHolding><securityTitle><value>Common Stock</value></securityTitle></nonDerivativeHolding></nonDerivativeTable>',
    });
    expect(parseForm4(xml).transactions).toEqual([]);
  });

  it('fills in nulls for a transaction with only the required fields', () => {
    const xml = form4({
      nonDerivative: [
        '<nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2024-01-02</value></transactionDate><transactionCoding><transactionCode>P</transactionCode></transactionCoding></nonDerivativeTransaction>',
      ],
    });
    expect(parseForm4(xml).transactions[0]).toMatchObject({
      shares: null,
      price: null,
      sharesOwnedAfter: null,
      acquiredDisposed: null,
      ownership: null,
      isQualifying: false,
    });
  });
});

describe('parseForm4: prices', () => {
  it('parses numbers with thousands separators', () => {
    const [t] = parseForm4(form4({ nonDerivative: [nd({ shares: '1,500', price: '2,000.25' })] })).transactions;
    expect(t.shares).toBe(1500);
    expect(t.price).toBe(2000.25);
  });

  it('returns null for a non-numeric price', () => {
    expect(parseForm4(form4({ nonDerivative: [nd({ price: 'n/a' })] })).transactions[0].price).toBeNull();
  });

  it('returns null and does not qualify when the price is missing', () => {
    const [t] = parseForm4(form4({ nonDerivative: [nd({ price: null })] })).transactions;
    expect(t.price).toBeNull();
    expect(t.isQualifying).toBe(false);
  });

  it('returns null and keeps the footnote when the price is only in a footnote', () => {
    const xml = form4({
      nonDerivative: [nd({ price: null, priceFootnotes: ['F1'] })],
      footnotes: { F1: 'Weighted average price of $9.80.' },
    });
    const [t] = parseForm4(xml).transactions;
    expect(t.price).toBeNull();
    expect(t.footnotes).toEqual(['Weighted average price of $9.80.']);
    expect(t.isQualifying).toBe(false);
  });

  it('does not qualify a zero price', () => {
    expect(parseForm4(form4({ nonDerivative: [nd({ price: '0' })] })).transactions[0].isQualifying).toBe(false);
  });
});

describe('parseForm4: footnotes', () => {
  it('collects footnotes from anywhere in the transaction, once each', () => {
    const xml = form4({
      nonDerivative: [nd({ titleFootnotes: ['F1', 'F2'], priceFootnotes: ['F1'] })],
      footnotes: { F1: 'One', F2: 'Two' },
    });
    expect(parseForm4(xml).transactions[0].footnotes).toEqual(['One', 'Two']);
  });

  it('skips references to footnotes that do not exist', () => {
    const xml = form4({ nonDerivative: [nd({ titleFootnotes: ['F9'] })], footnotes: { F1: 'One' } });
    expect(parseForm4(xml).transactions[0].footnotes).toEqual([]);
  });

  it('keeps an empty footnote as an empty string', () => {
    const xml = form4({
      nonDerivative: [nd({ titleFootnotes: ['F1'] })],
      footnotes: { F1: '' },
    });
    expect(parseForm4(xml).transactions[0].footnotes).toEqual(['']);
  });

  it('handles an empty footnotes element and no footnotes element', () => {
    expect(parseForm4(form4({ footnotes: '' })).transactions).toHaveLength(1);
    expect(parseForm4(form4({ footnotes: null })).transactions).toHaveLength(1);
  });
});

describe('parseForm4: derivatives and 10b5-1', () => {
  it('flags derivative transactions and never qualifies them', () => {
    const p = parseForm4(form4({ nonDerivative: null, derivative: [deriv({ title: 'Stock Option (Right to Buy)' })] }));
    expect(p.transactions).toHaveLength(1);
    expect(p.transactions[0]).toMatchObject({ isDerivative: true, isQualifying: false });
  });

  it('keeps derivative-only filings', () => {
    const p = parseForm4(form4({ nonDerivative: [], derivative: [deriv({ code: 'M' }), deriv({ code: 'A' })] }));
    expect(p.transactions.every((t) => t.isDerivative)).toBe(true);
  });

  it('applies a document-level 10b5-1 flag to every transaction', () => {
    const p = parseForm4(form4({ aff10b5One: '1', nonDerivative: [nd(), nd()] }));
    expect(p.transactions.every((t) => t.is10b5_1 && !t.isQualifying)).toBe(true);
  });

  it('honours a per-transaction 10b5-1 flag', () => {
    const p = parseForm4(form4({ nonDerivative: [nd({ aff10b5One: 'true' }), nd()] }));
    expect(p.transactions.map((t) => t.is10b5_1)).toEqual([true, false]);
  });

  it('does not flag when the 10b5-1 element is 0', () => {
    expect(parseForm4(form4({ aff10b5One: '0' })).transactions[0].is10b5_1).toBe(false);
  });
});

describe('parseForm4: amendments and dates', () => {
  it('exposes the original submission date of a 4/A', () => {
    const p = parseForm4(form4({ documentType: '4/A', original: '2024-01-03' }));
    expect(p.documentType).toBe('4/A');
    expect(p.dateOfOriginalSubmission).toBe('2024-01-03');
  });

  it('strips a timezone offset from dates', () => {
    const p = parseForm4(form4({ period: '2020-03-05-05:00', nonDerivative: [nd({ date: '2020-03-04-05:00' })] }));
    expect(p.periodOfReport).toBe('2020-03-05');
    expect(p.transactions[0].transactionDate).toBe('2020-03-04');
  });
});

describe('parseForm4: errors', () => {
  const fails = (xml: string, message: RegExp) => {
    expect(() => parseForm4(xml)).toThrow(Form4ParseError);
    expect(() => parseForm4(xml)).toThrow(message);
  };

  it('rejects malformed XML', () => fails('<ownershipDocument><a></ownershipDocument>', /Invalid XML/));
  it('rejects a document without ownershipDocument', () => fails('<other/>', /Missing ownershipDocument/));
  it('rejects a missing document type', () => fails(form4({ documentType: null }), /document type/));
  it('rejects Form 3 and Form 5', () => {
    fails(form4({ documentType: '3' }), /Unsupported document type: 3/);
    fails(form4({ documentType: '5' }), /Unsupported document type: 5/);
  });
  it('rejects a filing with no reporting owner', () => fails(form4({ owners: [] }), /reporting owner/));
  it('rejects an owner without a CIK or name', () => {
    fails(form4({ owners: ['<reportingOwner/>'] }), /reporting owner CIK/);
    fails(
      form4({ owners: ['<reportingOwner><reportingOwnerId><rptOwnerCik>1</rptOwnerCik></reportingOwnerId></reportingOwner>'] }),
      /reporting owner name/,
    );
  });
  it('rejects a missing issuer CIK or name', () => {
    fails(form4({ issuerCik: null }), /issuer CIK/);
    fails(form4({ issuerName: null }), /issuer name/);
  });
  it('rejects a transaction missing its title, date or code', () => {
    fails(form4({ nonDerivative: [nd({ title: null })] }), /security title/);
    fails(form4({ nonDerivative: [nd({ date: null })] }), /transaction date/);
    fails(form4({ nonDerivative: [nd({ code: null })] }), /transaction code/);
  });
  it('rejects an unparseable date', () => fails(form4({ nonDerivative: [nd({ date: 'yesterday' })] }), /Invalid transaction date/));
  it('rejects a transaction with no coding block at all', () => {
    fails(
      form4({
        nonDerivative: [
          '<nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2024-01-02</value></transactionDate></nonDerivativeTransaction>',
        ],
      }),
      /transaction code/,
    );
  });
  it('rejects a missing issuer block', () => {
    fails(
      '<ownershipDocument><documentType>4</documentType><reportingOwner><reportingOwnerId><rptOwnerCik>1</rptOwnerCik><rptOwnerName>X</rptOwnerName></reportingOwnerId></reportingOwner></ownershipDocument>',
      /issuer CIK/,
    );
  });
});
