/**
 * Starting state for the hosted questionnaire.
 *
 * In its own file with no "use server" directive: everything exported from a
 * "use server" module arrives at the importer as a server action, so a plain
 * object exported from one silently becomes a function.
 */

export type AnswerState = { error: string | null; notice: string | null }

export const emptyAnswerState: AnswerState = { error: null, notice: null }
