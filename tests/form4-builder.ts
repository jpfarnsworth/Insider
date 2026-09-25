// Builds synthetic Form 4 XML for unit tests. Real EDGAR filings live in
// tests/fixtures and are exercised by lib/form4/fixtures.test.ts.

interface OwnerOpts {
  cik?: string;
  name?: string;
  director?: string;
  officer?: string;
  tenPct?: string;
  other?: string;
  title?: string;
}

interface TxOpts {
  title?: string | null;
  date?: string | null;
  code?: string | null;
  shares?: string | null;
  price?: string | null;
  priceFootnotes?: string[];
  titleFootnotes?: string[];
  ad?: string | null;
  after?: string | null;
  own?: string | null;
  aff10b5One?: string;
}

const val = (tag: string, v: string | null | undefined, foot: string[] = []) =>
  v === null || v === undefined
    ? foot.length
      ? `<${tag}>${foot.map((f) => `<footnoteId id="${f}"/>`).join('')}</${tag}>`
      : ''
    : `<${tag}><value>${v}</value>${foot.map((f) => `<footnoteId id="${f}"/>`).join('')}</${tag}>`;

export function owner(o: OwnerOpts = {}): string {
  return `<reportingOwner>
    <reportingOwnerId><rptOwnerCik>${o.cik ?? '0001111111'}</rptOwnerCik><rptOwnerName>${o.name ?? 'Doe John'}</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>${o.director ?? '0'}</isDirector><isOfficer>${o.officer ?? '0'}</isOfficer>
      <isTenPercentOwner>${o.tenPct ?? '0'}</isTenPercentOwner><isOther>${o.other ?? '0'}</isOther>
      ${o.title ? `<officerTitle>${o.title}</officerTitle>` : ''}
    </reportingOwnerRelationship>
  </reportingOwner>`;
}

export function tx(kind: 'nonDerivativeTransaction' | 'derivativeTransaction', t: TxOpts = {}): string {
  const has = (k: keyof TxOpts) => t[k] !== null;
  return `<${kind}>
    ${val('securityTitle', has('title') ? (t.title ?? 'Common Stock') : null, t.titleFootnotes)}
    ${val('transactionDate', has('date') ? (t.date ?? '2024-01-02') : null)}
    <transactionCoding>${has('code') ? `<transactionCode>${t.code ?? 'P'}</transactionCode>` : ''}</transactionCoding>
    <transactionAmounts>
      ${val('transactionShares', t.shares === undefined ? '1000' : t.shares)}
      ${val('transactionPricePerShare', t.price === undefined ? '10.50' : t.price, t.priceFootnotes)}
      ${val('transactionAcquiredDisposedCode', t.ad === undefined ? 'A' : t.ad)}
    </transactionAmounts>
    <postTransactionAmounts>${val('sharesOwnedFollowingTransaction', t.after === undefined ? '5000' : t.after)}</postTransactionAmounts>
    <ownershipNature>${val('directOrIndirectOwnership', t.own === undefined ? 'D' : t.own)}</ownershipNature>
    ${t.aff10b5One ? `<aff10b5One>${t.aff10b5One}</aff10b5One>` : ''}
  </${kind}>`;
}

export const nd = (t?: TxOpts) => tx('nonDerivativeTransaction', t);
export const deriv = (t?: TxOpts) => tx('derivativeTransaction', t);

interface DocOpts {
  documentType?: string | null;
  period?: string | null;
  original?: string;
  issuerCik?: string | null;
  issuerName?: string | null;
  symbol?: string | null;
  owners?: string[];
  nonDerivative?: string[] | null;
  derivative?: string[] | null;
  footnotes?: Record<string, string> | '' | null;
  aff10b5One?: string;
  rawBody?: string;
}

export function form4(o: DocOpts = {}): string {
  const issuer = `<issuer>
    ${o.issuerCik === null ? '' : `<issuerCik>${o.issuerCik ?? '0000123456'}</issuerCik>`}
    ${o.issuerName === null ? '' : `<issuerName>${o.issuerName ?? 'Acme Corp'}</issuerName>`}
    ${o.symbol === null ? '' : `<issuerTradingSymbol>${o.symbol ?? 'ACME'}</issuerTradingSymbol>`}
  </issuer>`;
  const table = (name: string, items: string[] | null | undefined, dflt: string[]) => {
    const list = items === undefined ? dflt : items;
    return list === null ? '' : list.length ? `<${name}>${list.join('')}</${name}>` : `<${name}/>`;
  };
  const foot =
    o.footnotes === undefined || o.footnotes === null
      ? ''
      : o.footnotes === ''
        ? '<footnotes/>'
        : `<footnotes>${Object.entries(o.footnotes)
            .map(([id, text]) => `<footnote id="${id}">${text}</footnote>`)
            .join('')}</footnotes>`;

  return `<?xml version="1.0"?>
<ownershipDocument>
  <schemaVersion>X0508</schemaVersion>
  ${o.documentType === null ? '' : `<documentType>${o.documentType ?? '4'}</documentType>`}
  ${o.period === null ? '' : `<periodOfReport>${o.period ?? '2024-01-02'}</periodOfReport>`}
  ${o.original ? `<dateOfOriginalSubmission>${o.original}</dateOfOriginalSubmission>` : ''}
  ${o.aff10b5One ? `<aff10b5One>${o.aff10b5One}</aff10b5One>` : ''}
  ${issuer}
  ${(o.owners ?? [owner()]).join('')}
  ${table('nonDerivativeTable', o.nonDerivative, [nd()])}
  ${table('derivativeTable', o.derivative, [])}
  ${foot}
  ${o.rawBody ?? ''}
</ownershipDocument>`;
}
