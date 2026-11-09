import type { ParsedAnswer } from '@/onboard/parse-answers'

/**
 * Starting state for the paste-back importer.
 *
 * Its own file with no "use server" directive: everything exported from a
 * "use server" module arrives at the importer as a server action, so a plain
 * object exported from one silently becomes a function reference.
 */

export type ImportState = {
  error: string | null
  notice: string | null
  /** Null until something has been read; the preview exists only after that. */
  rows: ParsedAnswer[] | null
  /** How many responses the paste contained, when it was a sheet. */
  responses: number
}

export const emptyImportState: ImportState = {
  error: null,
  notice: null,
  rows: null,
  responses: 1,
}
