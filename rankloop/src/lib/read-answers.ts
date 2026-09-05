import { ALL_QUESTION_KEYS } from '../onboard/questionnaire'

/**
 * Pulls the intake answers out of a submitted form.
 *
 * Reads only known keys, so a field added to the page by anything other than
 * the questionnaire definition cannot write a row nobody will ever read back.
 */
export function readAnswers(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of ALL_QUESTION_KEYS) {
    out[key] = String(formData.get(`fact_${key}`) ?? '')
  }
  return out
}
