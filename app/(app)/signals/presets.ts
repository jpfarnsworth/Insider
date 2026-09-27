'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { savedFilters } from '@/db/schema';
import { requireUser } from '@/lib/auth/require-user';
import { parseFilters, toQuery } from '@/lib/signals/filters';

const MAX_NAME = 40;
const MAX_PRESETS = 30;

/** Saves the list's current filters under a name (same name overwrites). */
export async function savePreset(formData: FormData) {
  await requireUser();
  const name = String(formData.get('name') ?? '').trim().slice(0, MAX_NAME);
  if (!name) return;
  // Re-parse so only known, valid filters are ever stored.
  const params = toQuery(parseFilters(Object.fromEntries(new URLSearchParams(String(formData.get('params') ?? '')))));
  const existing = await db.select({ id: savedFilters.id }).from(savedFilters);
  if (existing.length >= MAX_PRESETS) throw new Error(`At most ${MAX_PRESETS} saved filters`);
  await db
    .insert(savedFilters)
    .values({ name, params })
    .onConflictDoUpdate({ target: savedFilters.name, set: { params, updatedAt: new Date() } });
  revalidatePath('/signals');
  redirect(params ? `/signals?${params}` : '/signals');
}

export async function deletePreset(formData: FormData) {
  await requireUser();
  const id = String(formData.get('id') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid preset');
  await db.delete(savedFilters).where(eq(savedFilters.id, id));
  revalidatePath('/signals');
}
