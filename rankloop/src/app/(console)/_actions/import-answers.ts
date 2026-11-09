'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { loadFacts, saveFacts } from '@/lib/facts'
import { parseAnswers } from '@/onboard/parse-answers'
import type { ImportState } from './import-answers-state'

/**
 * Reading a client's Google Form answers back into the questionnaire.
 *
 * Two intentions, one form, chosen by which button was pressed — the same
 * shape as the client-links form, and for the same reason: both act on the
 * same text and duplicating it so a second form can see it is how the two
 * drift apart.
 *
 * Reading never writes. The parser is confident about most headings and wrong
 * about some, and an operator who pressed one button and found fourteen answers
 * replaced would have no way back. So the first press only shows what it found,
 * every value is editable before the second press, and the second press writes
 * exactly what is on screen rather than re-parsing anything.
 */
export async function importAnswersAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const clientId = Number(formData.get('clientId'))
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return { error: 'No client was given.', notice: null, rows: null, responses: 1 }
  }

  return String(formData.get('intent')) === 'save'
    ? save(clientId, formData)
    : read(clientId, formData)
}

function read(clientId: number, formData: FormData): ImportState {
  const pasted = String(formData.get('pasted') ?? '')
  if (!pasted.trim()) {
    return {
      error: 'Nothing was pasted. Copy the response out of the Google Sheet and paste it here.',
      notice: null,
      rows: null,
      responses: 1,
    }
  }

  const facts = loadFacts(db, clientId)
  const { rows, responses } = parseAnswers(pasted, facts)

  const matched = rows.filter((r) => r.key).length
  if (matched === 0) {
    return {
      error:
        'None of that matched a question. Paste the header row and a response row from the ' +
        'Google Sheet, or the question-and-answer text from a single response.',
      notice: null,
      rows,
      responses,
    }
  }

  return { error: null, notice: null, rows, responses }
}

/**
 * Writes what is on screen, not what was parsed.
 *
 * Every value in the preview is editable, so the form data is the source of
 * truth here — re-parsing would silently discard a correction an operator just
 * made. Only the keys the preview listed are read, and a blank one is skipped
 * rather than written, because the preview's own blanks mean "this did not
 * come through", not "delete what you have".
 */
function save(clientId: number, formData: FormData): ImportState {
  const keys = String(formData.get('keys') ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)

  const answers: Record<string, string> = {}
  for (const key of keys) {
    const value = String(formData.get(`fact_${key}`) ?? '').trim()
    if (value) answers[key] = value
  }

  const count = Object.keys(answers).length
  if (count === 0) {
    return {
      error: 'Nothing was selected to save.',
      notice: null,
      rows: null,
      responses: 1,
    }
  }

  try {
    saveFacts(db, clientId, answers)
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      notice: null,
      rows: null,
      responses: 1,
    }
  }

  revalidatePath('/intake')
  revalidatePath('/fixes')

  return {
    error: null,
    notice:
      `${count} answer${count === 1 ? '' : 's'} written into the questionnaire. ` +
      'The fix list picks them up the next time the recommendations step runs.',
    rows: null,
    responses: 1,
  }
}
