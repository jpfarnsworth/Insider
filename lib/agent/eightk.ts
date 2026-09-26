// Titles and dates of an issuer's recent 8-Ks (spec §5.2, titles only in v1), read from
// EDGAR's submissions JSON. Only filings accepted by the signal time are listed.

const ITEM_TITLES: Record<string, string> = {
  '1.01': 'Entry into a Material Definitive Agreement',
  '1.02': 'Termination of a Material Definitive Agreement',
  '1.03': 'Bankruptcy or Receivership',
  '1.05': 'Material Cybersecurity Incidents',
  '2.01': 'Completion of Acquisition or Disposition of Assets',
  '2.02': 'Results of Operations and Financial Condition',
  '2.03': 'Creation of a Direct Financial Obligation',
  '2.04': 'Triggering Events That Accelerate or Increase a Direct Financial Obligation',
  '2.05': 'Costs Associated with Exit or Disposal Activities',
  '2.06': 'Material Impairments',
  '3.01': 'Notice of Delisting or Failure to Satisfy a Continued Listing Rule',
  '3.02': 'Unregistered Sales of Equity Securities',
  '3.03': 'Material Modification to Rights of Security Holders',
  '4.01': "Changes in Registrant's Certifying Accountant",
  '4.02': 'Non-Reliance on Previously Issued Financial Statements',
  '5.01': 'Changes in Control of Registrant',
  '5.02': 'Departure or Appointment of Directors or Officers',
  '5.03': 'Amendments to Articles of Incorporation or Bylaws',
  '5.07': 'Submission of Matters to a Vote of Security Holders',
  '7.01': 'Regulation FD Disclosure',
  '8.01': 'Other Events',
  '9.01': 'Financial Statements and Exhibits',
};

export interface EightK {
  /** YYYY-MM-DD */
  date: string;
  form: string;
  items: string[];
}

export interface EightKList {
  filings: EightK[];
  /** False when the submissions file doesn't reach back to the start of the window. */
  complete: boolean;
}

interface Submissions {
  filings?: {
    recent?: {
      form?: string[];
      filingDate?: string[];
      acceptanceDateTime?: string[];
      items?: string[];
    };
    files?: unknown[];
  };
}

export const submissionsUrl = (cik: string) => `https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`;

export function itemTitle(code: string): string {
  return ITEM_TITLES[code] ? `${code} ${ITEM_TITLES[code]}` : `Item ${code}`;
}

/**
 * 8-Ks (and 8-K/As) accepted in the `windowDays` days up to `signalAt`. Never lists
 * a filing accepted after the signal, so nothing from the future reaches the model.
 */
export function recentEightKs(json: Submissions, signalAt: Date, windowDays = 90): EightKList {
  const recent = json.filings?.recent;
  const forms = recent?.form ?? [];
  const from = new Date(signalAt.getTime() - windowDays * 86_400_000);

  const filings: EightK[] = [];
  let oldest = Infinity;
  for (const [i, form] of forms.entries()) {
    const accepted = new Date(recent?.acceptanceDateTime?.[i] ?? `${recent?.filingDate?.[i]}T00:00:00Z`);
    if (Number.isNaN(accepted.getTime())) continue;
    oldest = Math.min(oldest, accepted.getTime());
    if ((form === '8-K' || form === '8-K/A') && accepted <= signalAt && accepted >= from) {
      filings.push({
        date: (recent?.filingDate?.[i] ?? accepted.toISOString()).slice(0, 10),
        form,
        items: (recent?.items?.[i] ?? '').split(',').map((c) => c.trim()).filter(Boolean).map(itemTitle),
      });
    }
  }

  // "recent" holds about the latest 1,000 filings; older ones are in extra files we don't read.
  const covered = Number.isFinite(oldest) && (oldest <= from.getTime() || !(json.filings?.files?.length ?? 0));
  return { filings: filings.sort((a, b) => b.date.localeCompare(a.date)), complete: covered };
}
