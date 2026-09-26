'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { issuers, watchlist } from '@/db/schema';
import { requireUser } from '@/lib/auth/require-user';

const CIK = /^\d{1,10}$/;
const MAX_NOTE = 1000;

function refresh() {
  revalidatePath('/watchlist');
  revalidatePath('/companies');
  revalidatePath('/signals');
}

/** Pins an issuer (by CIK, or by ticker typed on the watchlist page). Idempotent. */
export async function addToWatchlist(formData: FormData) {
  await requireUser();
  const raw = String(formData.get('issuer') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim().slice(0, MAX_NOTE) || null;
  if (!raw) return;

  const cik = CIK.test(raw) ? raw.padStart(10, '0') : null;
  const [issuer] = await db
    .select({ cik: issuers.cik })
    .from(issuers)
    .where(cik ? eq(issuers.cik, cik) : eq(issuers.ticker, raw.toUpperCase()))
    .limit(1);
  if (!issuer) throw new Error(`No company found for "${raw}"`);

  await db.insert(watchlist).values({ issuerCik: issuer.cik, note }).onConflictDoNothing();
  refresh();
  revalidatePath(`/companies/${issuer.cik}`);
}

export async function removeFromWatchlist(formData: FormData) {
  await requireUser();
  const cik = String(formData.get('issuer') ?? '');
  if (!CIK.test(cik)) throw new Error('Invalid company');
  await db.delete(watchlist).where(eq(watchlist.issuerCik, cik));
  refresh();
  revalidatePath(`/companies/${cik}`);
}

export async function updateWatchNote(formData: FormData) {
  await requireUser();
  const cik = String(formData.get('issuer') ?? '');
  if (!CIK.test(cik)) throw new Error('Invalid company');
  const note = String(formData.get('note') ?? '').trim().slice(0, MAX_NOTE) || null;
  await db.update(watchlist).set({ note }).where(eq(watchlist.issuerCik, cik));
  refresh();
}
