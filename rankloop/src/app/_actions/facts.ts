'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { saveFacts } from '@/lib/facts'
import { readAnswers } from '@/lib/read-answers'

export type FactsState = { notice: string | null; error: string | null }

/**
 * Saves the intake answers for a client already on file.
 *
 * Says plainly that the fix list does not change until it is rebuilt: the
 * answers only reach the recommendations through a run, and an operator who
 * expects the placeholders to vanish on save would think the feature was
 * broken.
 */
export async function saveFactsAction(
  _prev: FactsState,
  formData: FormData,
): Promise<FactsState> {
  const clientId = Number(formData.get('clientId'))
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return { notice: null, error: 'No client was given.' }
  }

  try {
    saveFacts(db, clientId, readAnswers(formData))
  } catch (err) {
    return { notice: null, error: err instanceof Error ? err.message : String(err) }
  }

  revalidatePath('/intake')
  revalidatePath('/fixes')
  return {
    notice:
      'Saved. The fix list picks these up the next time the recommendations step runs — start a run that skips the engines and it takes about a minute.',
    error: null,
  }
}
