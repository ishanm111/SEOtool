/**
 * Starting state for the Google Form button.
 *
 * Its own file with no "use server" directive, for the reason in form-state.ts:
 * everything exported from a "use server" module arrives at the importer as a
 * server action, so a plain object exported from one silently becomes a
 * function reference.
 */

export type FormState = { error: string | null; notice: string | null }

export const emptyFormState: FormState = { error: null, notice: null }
