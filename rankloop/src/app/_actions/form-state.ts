/**
 * The starting state for every form driven by a server action.
 *
 * Deliberately not in the action modules beside the actions they belong to,
 * which is where they were and where they look like they belong.
 *
 * A module marked "use server" exports actions, and the compiler treats
 * *everything* it exports as one: a plain object exported from such a file
 * arrives in the importing component as a function reference to a server
 * action, not as the object that was written. Reading a field off it gives
 * undefined rather than throwing, so the mistake hides — `emptyFixState` sat in
 * the fixes module for months, and every form using it began life with a
 * function as its state. Nothing visibly broke, because the two fields it
 * should have held are only ever tested for truthiness.
 *
 * It stops hiding the moment a state has an array in it: the first render of
 * the report page read `.length` off nothing and took the whole page down.
 *
 * This file has no directive, so what is written here is what arrives.
 */

/** A form that reports one error or one notice. */
export type FixState = { error: string | null; notice: string | null }

export const emptyFixState: FixState = { error: null, notice: null }

/** Saving the client documents: what was written, and what could not be. */
export type DocumentsState = {
  saved: string[]
  problems: string[]
  error: string | null
}

export const emptyDocumentsState: DocumentsState = { saved: [], problems: [], error: null }
