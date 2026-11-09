'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { deleteClientAction, type DeleteClientState } from '../_actions/clients'

/**
 * Removing a client, folded away behind a summary.
 *
 * Deliberately the least prominent control on the card, and deliberately not a
 * one-press one. What it destroys is not a row: it is every answer an engine
 * ever gave about that business, every finding, and the record of what their
 * pages said before a fix was published. There is no undo, and the counts are
 * shown rather than described so the decision is made against the real number.
 *
 * The name has to be typed. A confirm dialog is dismissed by reflex; typing a
 * business name is not something anybody does by accident, and it also rules
 * out deleting the card next to the one that was meant.
 */
export function DeleteClient({
  clientId,
  name,
  counts,
  appliedFixes,
  busyReason,
}: {
  clientId: number
  name: string
  /** What goes with them, already counted by the page that renders this. */
  counts: { answers: number; findings: number; recommendations: number; runs: number }
  appliedFixes: number
  /** Set while a run is in flight, which has to be stopped first. */
  busyReason?: string | null
}) {
  const [state, action] = useActionState<DeleteClientState, FormData>(deleteClientAction, {
    error: null,
  })

  /** "1 run", not "1 runs" — a count nobody proof-reads is a count nobody trusts. */
  const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`

  const goes = [
    counts.answers > 0 && many(counts.answers, 'AI answer'),
    counts.findings > 0 && many(counts.findings, 'finding'),
    counts.recommendations > 0 && many(counts.recommendations, 'recommendation'),
    counts.runs > 0 && many(counts.runs, 'run'),
  ].filter(Boolean) as string[]

  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs text-ink-3 marker:content-none hover:text-rose">
        Delete
      </summary>

      <form action={action} className="mt-3 rounded-xl border border-rose/25 bg-rose-soft p-4">
        <input type="hidden" name="clientId" value={clientId} />

        <p className="text-sm font-semibold text-rose">Delete {name} permanently</p>

        <p className="mt-1 text-xs text-ink-2">
          {goes.length > 0
            ? `${goes.join(', ')} and the screenshots of every answer go with them. Nothing here can be recovered.`
            : 'Nothing has been measured for this client yet, so only the client record goes.'}
        </p>

        {appliedFixes > 0 && (
          <p className="mt-2 text-xs font-semibold text-rose">
            {appliedFixes} {appliedFixes === 1 ? 'fix has' : 'fixes have'} been published to their
            live site. The record of what those pages said before is deleted too, so those changes
            can no longer be reverted from here.
          </p>
        )}

        {busyReason ? (
          <p className="mt-3 text-xs text-ink-2">{busyReason}</p>
        ) : (
          <>
            <label htmlFor={`confirm-${clientId}`} className="field-label mt-3">
              Type the business name to confirm
            </label>
            <input
              id={`confirm-${clientId}`}
              name="confirmName"
              className="field"
              placeholder={name}
              autoComplete="off"
            />

            {state.error && <p className="mt-2 text-xs text-rose">{state.error}</p>}

            <div className="mt-3">
              <Delete name={name} />
            </div>
          </>
        )}
      </form>
    </details>
  )
}

function Delete({ name }: { name: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-danger btn-sm" disabled={pending}>
      {pending ? 'Deleting…' : `Delete ${name}`}
    </button>
  )
}
