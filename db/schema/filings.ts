import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './_helpers';

export const issuers = pgTable('issuers', {
  cik: text('cik').primaryKey(),
  name: text('name').notNull(),
  ticker: text('ticker'),
  exchange: text('exchange'),
  sector: text('sector'),
  industry: text('industry'),
  marketCap: numeric('market_cap', { precision: 20, scale: 2 }),
  marketCapAsOf: date('market_cap_as_of'),
  ...timestamps,
});

export const insiders = pgTable('insiders', {
  cik: text('cik').primaryKey(),
  name: text('name').notNull(),
  ...timestamps,
});

export const filings = pgTable(
  'filings',
  {
    id: id(),
    accessionNo: text('accession_no').notNull().unique(),
    formType: text('form_type').notNull(), // '4' | '4/A'
    issuerCik: text('issuer_cik')
      .notNull()
      .references(() => issuers.cik),
    // Acceptance datetime is when the market could first know (spec §3.1).
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull(),
    filedAt: date('filed_at').notNull(),
    url: text('url').notNull(),
    isAmendment: boolean('is_amendment').notNull().default(false),
    // Accession number of the original filing; not an FK because the original
    // may not have been ingested (e.g. filed before the backfill window).
    amendsAccessionNo: text('amends_accession_no'),
    rawXml: text('raw_xml'),
    parseStatus: text('parse_status', { enum: ['pending', 'parsed', 'failed'] })
      .notNull()
      .default('pending'),
    parseError: text('parse_error'),
    ...timestamps,
  },
  (t) => [
    index('filings_accepted_at_idx').on(t.acceptedAt),
    index('filings_issuer_cik_idx').on(t.issuerCik),
    index('filings_parse_status_idx').on(t.parseStatus),
  ],
);

export const filingOwners = pgTable(
  'filing_owners',
  {
    id: id(),
    filingId: uuid('filing_id')
      .notNull()
      .references(() => filings.id, { onDelete: 'cascade' }),
    insiderCik: text('insider_cik')
      .notNull()
      .references(() => insiders.cik),
    isDirector: boolean('is_director').notNull().default(false),
    isOfficer: boolean('is_officer').notNull().default(false),
    officerTitle: text('officer_title'),
    isTenPctOwner: boolean('is_ten_pct_owner').notNull().default(false),
    isOther: boolean('is_other').notNull().default(false),
    ...timestamps,
  },
  (t) => [index('filing_owners_filing_id_idx').on(t.filingId)],
);

export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    filingId: uuid('filing_id')
      .notNull()
      .references(() => filings.id, { onDelete: 'cascade' }),
    insiderCik: text('insider_cik')
      .notNull()
      .references(() => insiders.cik),
    issuerCik: text('issuer_cik')
      .notNull()
      .references(() => issuers.cik),
    securityTitle: text('security_title').notNull(),
    isDerivative: boolean('is_derivative').notNull().default(false),
    transactionDate: date('transaction_date').notNull(),
    code: text('code').notNull(),
    shares: numeric('shares', { precision: 20, scale: 4 }),
    price: numeric('price', { precision: 20, scale: 4 }),
    value: numeric('value', { precision: 24, scale: 4 }).generatedAlwaysAs(
      sql`shares * price`,
    ),
    acquiredDisposed: text('acquired_disposed', { enum: ['A', 'D'] }),
    sharesOwnedAfter: numeric('shares_owned_after', { precision: 20, scale: 4 }),
    ownership: text('ownership', { enum: ['D', 'I'] }),
    is10b5_1: boolean('is_10b5_1').notNull().default(false),
    footnotes: jsonb('footnotes').$type<string[]>().notNull().default([]),
    isQualifying: boolean('is_qualifying').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index('transactions_issuer_date_idx').on(t.issuerCik, t.transactionDate),
    index('transactions_insider_idx').on(t.insiderCik),
    index('transactions_filing_id_idx').on(t.filingId),
  ],
);
