import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { isQualifyingPurchase } from './qualify';
import type { ParsedForm4, ParsedOwner, ParsedTransaction } from './types';

export class Form4ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Form4ParseError';
  }
}

type Node = Record<string, unknown>;

const ARRAY_TAGS = new Set([
  'reportingOwner',
  'nonDerivativeTransaction',
  'derivativeTransaction',
  'footnote',
  'footnoteId',
]);

// parseTagValue off: CIKs have leading zeros and must stay strings.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

/** Text of a node that is a string, `<x><value>..</value></x>`, or text with attributes. */
function textOf(node: unknown): string | null {
  if (typeof node === 'string') return node || null;
  if (node && typeof node === 'object') {
    const n = node as Node;
    return textOf('value' in n ? n.value : n['#text']);
  }
  return null;
}

function required(node: unknown, what: string): string {
  const value = textOf(node);
  if (value === null) throw new Form4ParseError(`Missing ${what}`);
  return value;
}

function toBool(node: unknown): boolean {
  const v = textOf(node);
  return v === '1' || v?.toLowerCase() === 'true';
}

function toNumber(node: unknown): number | null {
  const v = textOf(node);
  if (v === null) return null;
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Dates are xs:date and some filers append a timezone offset ("2020-03-05-05:00").
function toDate(node: unknown, what: string): string {
  const v = required(node, what);
  const m = /^\d{4}-\d{2}-\d{2}/.exec(v);
  if (!m) throw new Form4ParseError(`Invalid ${what}: ${v}`);
  return m[0];
}

function optionalDate(node: unknown, what: string): string | null {
  return textOf(node) === null ? null : toDate(node, what);
}

// Only `footnoteId` is ever an array inside a transaction (see ARRAY_TAGS), and
// it is handled by key, so there is no need to walk arrays.
function collectFootnoteIds(node: unknown, ids: Set<string>): void {
  if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node as Node)) {
      if (key === 'footnoteId') {
        (child as Node[]).forEach((f) => ids.add(String(f['@_id'])));
      } else {
        collectFootnoteIds(child, ids);
      }
    }
  }
}

function parseOwner(raw: Node): ParsedOwner {
  const id = (raw.reportingOwnerId ?? {}) as Node;
  const rel = (raw.reportingOwnerRelationship ?? {}) as Node;
  return {
    cik: required(id.rptOwnerCik, 'reporting owner CIK'),
    name: required(id.rptOwnerName, 'reporting owner name'),
    isDirector: toBool(rel.isDirector),
    isOfficer: toBool(rel.isOfficer),
    officerTitle: textOf(rel.officerTitle),
    isTenPctOwner: toBool(rel.isTenPercentOwner),
    isOther: toBool(rel.isOther),
  };
}

function parseTransaction(
  raw: Node,
  isDerivative: boolean,
  docIs10b5_1: boolean,
  footnotes: Map<string, string>,
): ParsedTransaction {
  const coding = (raw.transactionCoding ?? {}) as Node;
  const amounts = (raw.transactionAmounts ?? {}) as Node;
  const post = (raw.postTransactionAmounts ?? {}) as Node;
  const nature = (raw.ownershipNature ?? {}) as Node;

  const ids = new Set<string>();
  collectFootnoteIds(raw, ids);

  const acquiredDisposed = textOf(amounts.transactionAcquiredDisposedCode);
  const ownership = textOf(nature.directOrIndirectOwnership);

  const tx = {
    securityTitle: required(raw.securityTitle, 'security title'),
    isDerivative,
    transactionDate: toDate(raw.transactionDate, 'transaction date'),
    code: required(coding.transactionCode, 'transaction code'),
    shares: toNumber(amounts.transactionShares),
    price: toNumber(amounts.transactionPricePerShare),
    acquiredDisposed: acquiredDisposed === 'A' || acquiredDisposed === 'D' ? acquiredDisposed : null,
    sharesOwnedAfter: toNumber(post.sharesOwnedFollowingTransaction),
    ownership: ownership === 'D' || ownership === 'I' ? ownership : null,
    is10b5_1: docIs10b5_1 || toBool(raw.aff10b5One),
    footnotes: [...ids].flatMap((id) => footnotes.get(id) ?? []),
  } satisfies Omit<ParsedTransaction, 'isQualifying'>;

  return { ...tx, isQualifying: isQualifyingPurchase(tx) };
}

/** Parses a Form 4 / 4/A `ownershipDocument`. Throws Form4ParseError if it can't. */
export function parseForm4(xml: string): ParsedForm4 {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Form4ParseError(`Invalid XML: ${valid.err.msg}`);

  const doc = parser.parse(xml).ownershipDocument as Node | undefined;
  if (!doc) throw new Form4ParseError('Missing ownershipDocument');

  const documentType = required(doc.documentType, 'document type');
  if (documentType !== '4' && documentType !== '4/A') {
    throw new Form4ParseError(`Unsupported document type: ${documentType}`);
  }

  const issuer = (doc.issuer ?? {}) as Node;
  const owners = ((doc.reportingOwner ?? []) as Node[]).map(parseOwner);
  if (owners.length === 0) throw new Form4ParseError('Missing reporting owner');

  const footnotes = new Map<string, string>();
  for (const f of ((doc.footnotes as Node | undefined)?.footnote ?? []) as Node[]) {
    footnotes.set(String(f['@_id']), textOf(f) ?? '');
  }

  const docIs10b5_1 = toBool(doc.aff10b5One);
  const table = (name: string, child: string): Node[] =>
    ((doc[name] as Node | undefined)?.[child] ?? []) as Node[];

  return {
    documentType,
    periodOfReport: optionalDate(doc.periodOfReport, 'period of report'),
    dateOfOriginalSubmission: optionalDate(doc.dateOfOriginalSubmission, 'date of original submission'),
    issuer: {
      cik: required(issuer.issuerCik, 'issuer CIK'),
      name: required(issuer.issuerName, 'issuer name'),
      tradingSymbol: textOf(issuer.issuerTradingSymbol),
    },
    owners,
    transactions: [
      ...table('nonDerivativeTable', 'nonDerivativeTransaction').map((t) =>
        parseTransaction(t, false, docIs10b5_1, footnotes),
      ),
      ...table('derivativeTable', 'derivativeTransaction').map((t) =>
        parseTransaction(t, true, docIs10b5_1, footnotes),
      ),
    ],
  };
}
