/**
 * Starting state for the portal's forms.
 *
 * In its own file with no "use server" directive, for the reason written up in
 * the console's form-state module: everything exported from a "use server"
 * module arrives at the importer as a server action, so a plain object exported
 * from one silently becomes a function.
 */

export type PortalFormState = { error: string | null; notice: string | null }

export const emptyPortalFormState: PortalFormState = { error: null, notice: null }
