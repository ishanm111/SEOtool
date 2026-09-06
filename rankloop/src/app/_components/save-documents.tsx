'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { saveDocumentsAction } from '../_actions/report'
import { emptyDocumentsState, type DocumentsState } from '../_actions/form-state'

/**
 * Puts the audit and the fix pack on the Desktop as PDFs.
 *
 * A report that only exists inside a dashboard is not a deliverable — it gets
 * emailed, printed, or handed to whoever edits the site. The button says where
 * the files went rather than downloading them silently, because the point is
 * that the operator can find them afterwards.
 */
export function SaveDocuments({
  clientId,
  label = 'Save both as PDF',
}: {
  clientId: number
  label?: string
}) {
  const [state, action] = useActionState<DocumentsState, FormData>(
    saveDocumentsAction,
    emptyDocumentsState,
  )

  return (
    <form action={action} className="inline-block">
      <input type="hidden" name="clientId" value={clientId} />
      <Button label={label} />

      {state.saved.length > 0 && (
        <p className="mt-2 text-xs text-moss-deep">
          Saved to your Desktop:{' '}
          {state.saved.map((f) => f.split('/').pop()).join(' and ')}
        </p>
      )}
      {state.problems.map((p) => (
        <p key={p} className="mt-2 text-xs text-amber">
          {p}
        </p>
      ))}
      {state.error && <p className="mt-2 text-xs text-rose">{state.error}</p>}
    </form>
  )
}

function Button({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-secondary" disabled={pending}>
      {pending && (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current live-dot" aria-hidden />
      )}
      {pending ? 'Writing the PDFs…' : label}
    </button>
  )
}
