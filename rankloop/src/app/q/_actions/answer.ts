'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { loadFacts, saveFacts } from '@/lib/facts'
import { clientQuestionGroups } from '@/onboard/client-questionnaire'
import type { BusinessType } from '@/config'
import type { AnswerState } from './state'

/**
 * Saves what a business owner typed on their own questionnaire link.
 *
 * The token in the form is the only thing that says which client this is. A
 * client id would be fatal here: the page is reachable without signing in, so
 * anyone who could change a hidden field could write answers onto somebody
 * else's business. The token is looked up, and the id it resolves to is the
 * only id this action will ever write to.
 *
 * Only the keys this client is actually asked are read. A field added to the
 * page by anything other than the questionnaire definition cannot write a row,
 * and a question that was never on screen cannot have its existing answer
 * blanked by its own absence.
 */
export async function answerAction(
  _prev: AnswerState,
  formData: FormData,
): Promise<AnswerState> {
  const token = String(formData.get('token') ?? '').trim()
  if (!token) return { error: 'This link is missing its code. Ask your contact to resend it.', notice: null }

  const client = db
    .select({ id: schema.clients.id, businessType: schema.clients.businessType })
    .from(schema.clients)
    .where(eq(schema.clients.questionnaireToken, token))
    .get()

  if (!client) {
    return {
      error: 'This link is no longer valid. Ask your contact for a new one.',
      notice: null,
    }
  }

  const facts = loadFacts(db, client.id)
  const groups = clientQuestionGroups(client.businessType as BusinessType, facts)
  const keys = groups.flatMap((g) => g.questions.map((q) => q.key))

  const answers: Record<string, string> = {}
  for (const key of keys) {
    answers[key] = String(formData.get(`fact_${key}`) ?? '')
  }

  try {
    saveFacts(db, client.id, answers)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), notice: null }
  }

  db.update(schema.clients)
    .set({ questionnaireAnsweredAt: new Date() })
    .where(eq(schema.clients.id, client.id))
    .run()

  const given = Object.values(answers).filter((v) => v.trim()).length

  // The operator's own screens, not this one: the page re-reads on navigation.
  revalidatePath('/intake')
  revalidatePath('/fixes')

  return {
    error: null,
    notice:
      given === 0
        ? 'Saved. Nothing is filled in yet — come back to this same link whenever you have a minute.'
        : `Saved — thank you. ${given} answer${given === 1 ? '' : 's'} are on file. This link stays open, so you can come back and change any of them.`,
  }
}
