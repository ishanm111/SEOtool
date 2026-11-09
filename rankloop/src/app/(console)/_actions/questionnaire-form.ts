'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { loadFacts } from '@/lib/facts'
import { getClient } from '@/lib/queries'
import { createForm } from '@/engines/google-forms'
import {
  formDescriptionFor,
  formItemsFor,
  formTitleFor,
} from '@/onboard/questionnaire-form'
import type { FormState } from './questionnaire-form-state'

/**
 * Turns a client's questionnaire into a Google Form and keeps the link.
 *
 * The link is stored on the client rather than returned and forgotten, because
 * it is a thing an operator sends by text message and then needs again a week
 * later when the client says they lost it.
 *
 * Pressing the button a second time deliberately does not make a second form.
 * Two live forms for one business means two sets of answers and no way to say
 * which is current; replacing one is an explicit act, done with `regenerate`.
 */
export async function makeGoogleFormAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const clientId = Number(formData.get('clientId'))
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return { error: 'No client was given.', notice: null }
  }

  const client = getClient(clientId)
  if (!client) return { error: 'That client no longer exists.', notice: null }

  const regenerate = formData.get('regenerate') === 'yes'

  const existing = db
    .select({ url: schema.clients.questionnaireFormUrl })
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .get()

  if (existing?.url && !regenerate) {
    return { error: null, notice: 'A form already exists for this client.' }
  }

  const facts = loadFacts(db, clientId)
  const items = formItemsFor(client, facts)

  if (items.filter((i) => i.kind === 'question').length === 0) {
    return {
      error: 'Every question is already answered — there is nothing to ask.',
      notice: null,
    }
  }

  let created
  try {
    created = await createForm(formTitleFor(client), formDescriptionFor(client), items)
  } catch (err) {
    // The message from google-forms.ts is written to be read by an operator —
    // it names the missing variable and the command that fixes it.
    return { error: err instanceof Error ? err.message : String(err), notice: null }
  }

  db.update(schema.clients)
    .set({
      questionnaireFormId: created.formId,
      questionnaireFormUrl: created.responderUri,
      questionnaireFormEditUrl: created.editUri,
      questionnaireFormAt: new Date(),
    })
    .where(eq(schema.clients.id, clientId))
    .run()

  revalidatePath('/intake')

  const count = items.filter((i) => i.kind === 'question').length
  if (!created.shared) {
    return {
      error: null,
      notice:
        `Form made with ${count} questions, but it could not be shared automatically ` +
        `(${created.shareError}). Open it and set "Anyone with the link" before sending it.`,
    }
  }

  return { error: null, notice: `Form made with ${count} questions. The link is below.` }
}
