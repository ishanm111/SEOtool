/**
 * Starting state for the edit-and-re-inspect panel.
 *
 * Its own file with no "use server" directive, for the reason in form-state.ts:
 * a plain object exported from a "use server" module arrives at the importer as
 * a server action rather than as the object that was written.
 */

export type ReinspectState = { error: string | null; notice: string | null }

export const emptyReinspectState: ReinspectState = { error: null, notice: null }
