'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { newQuestionnaireToken } from '@/onboard/questionnaire-link'
import type { FormState } from './questionnaire-form-state'

/**
 * Issues the link a business fills its own questionnaire in on.
 *
 * Stored rather than derived, because the link is the deliverable: it goes out
 * by text message and is asked for again a week later. Pressing the button
 * twice returns the same link for the same reason — two live links for one
 * business is two sets of answers and no way to say which is current.
 *
 * Replacing one is an explicit act. It is also the only thing that can be done
 * about a link sent to the wrong number: the old token stops resolving the
 * instant the new one is written, and whoever has it sees a page that says so.
 */
export async function issueQuestionnaireLinkAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const clientId = Number(formData.get('clientId'))
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return { error: 'No client was given.', notice: null }
  }

  const row = db
    .select({ token: schema.clients.questionnaireToken })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .get()

  if (!row) return { error: 'That client no longer exists.', notice: null }

  const replacing = formData.get('regenerate') === 'yes'
  if (row.token && !replacing) {
    return { error: null, notice: 'This client already has a link.' }
  }

  db.update(schema.clients)
    .set({ questionnaireToken: newQuestionnaireToken(), questionnaireTokenAt: new Date() })
    .where(eq(schema.clients.id, clientId))
    .run()

  revalidatePath('/intake')

  return {
    error: null,
    notice: replacing
      ? 'New link made. The old one stops working immediately.'
      : 'Link made. Send it to the client — answers come straight back into the questionnaire above.',
  }
}
