'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { clientLocations } from '@/lib/resolve-client'
import { buildReportDocuments } from '@/report/build'
import { getClient } from '@/lib/queries'
import type { DocumentsState } from './form-state'

/**
 * Regenerating the two client documents from the console.
 *
 * The same code a run uses, so the file an operator produces by pressing a
 * button and the file a run produces are the same document — a client sent
 * whichever of two versions happened to be newer is how a report stops being
 * trusted.
 *
 * Nothing is re-measured. Both documents are rendered from what is already in
 * the database, which takes a second or two, most of it the browser that prints
 * the PDFs.
 */

export type { DocumentsState } from './form-state'

export async function saveDocumentsAction(
  _prev: DocumentsState,
  formData: FormData,
): Promise<DocumentsState> {
  /**
   * The client is named by the page rather than read from the cookie: the
   * button sits beside one client's report, and writing a different client's
   * documents because the active selection changed in another tab would be the
   * worst kind of quiet mistake.
   */
  const clientId = Number(formData.get('clientId'))
  const client = Number.isInteger(clientId) ? getClient(clientId) : null
  if (!client) return { saved: [], problems: [], error: 'That client no longer exists.' }

  try {
    const built = await buildReportDocuments(db, client, clientLocations(db, client.id))
    revalidatePath('/report')
    revalidatePath('/fixes')
    return {
      saved: built.pdfs.filter((p) => p.ok).map((p) => p.file),
      problems: built.pdfs.filter((p) => !p.ok).map((p) => (p.ok ? '' : `${p.file} — ${p.error}`)),
      error:
        built.data.fixes.length === 0
          ? 'There are no changes to put in a fix pack yet — run the recommendations step first.'
          : null,
    }
  } catch (err) {
    return {
      saved: [],
      problems: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
