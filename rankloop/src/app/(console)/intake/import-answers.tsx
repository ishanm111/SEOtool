'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { importAnswersAction } from '../_actions/import-answers'
import { emptyImportState } from '../_actions/import-answers-state'
import type { ParsedAnswer } from '@/onboard/parse-answers'

/**
 * Putting a client's Google Form answers back into the questionnaire.
 *
 * The Google route has always ended at a spreadsheet: the form goes out, the
 * client fills it in, and somebody retypes fourteen answers into the console.
 * This is the other half of it. Paste whatever came out of the sheet, check
 * what it matched, press save.
 *
 * Reading and saving are deliberately two presses. The matcher is right about
 * most headings and wrong about some, and the preview is the only chance
 * anybody gets to notice before an answer is overwritten — so every value in it
 * is editable, and the save writes what is on screen rather than what was
 * parsed.
 */

function Submit({ idle, busy, primary }: { idle: string; busy: string; primary?: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={primary ? 'btn btn-primary' : 'btn'} disabled={pending}>
      {pending && <span className="h-1.5 w-1.5 rounded-full bg-current live-dot" aria-hidden />}
      {pending ? busy : idle}
    </button>
  )
}

const ACTION_LABEL: Record<ParsedAnswer['action'], { text: string; className: string }> = {
  new: { text: 'New', className: 'bg-pine-soft text-pine-deep' },
  change: { text: 'Replaces', className: 'bg-amber-soft text-amber' },
  same: { text: 'Unchanged', className: 'bg-sink text-ink-3' },
  unmatched: { text: 'No match', className: 'bg-rose-soft text-rose' },
}

function Row({ row }: { row: ParsedAnswer }) {
  const label = ACTION_LABEL[row.action]

  return (
    <div className="border-t border-line py-4 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs ${label.className}`}>{label.text}</span>
        <span className="text-sm font-medium">{row.heading}</span>
        {row.quality === 'close' && (
          <span className="text-xs text-amber">matched by wording, not exactly — check it</span>
        )}
      </div>

      {row.action === 'unmatched' ? (
        <p className="mt-2 text-sm text-ink-3">
          No question in the questionnaire matches this. It will be skipped.
          {row.value && (
            <span className="mt-1 block break-words text-ink-2">“{row.value}”</span>
          )}
        </p>
      ) : (
        <>
          {row.current && row.action === 'change' && (
            <p className="mt-2 text-xs text-ink-3">
              Now on file: <span className="text-ink-2">{row.current}</span>
            </p>
          )}
          <textarea
            name={`fact_${row.key}`}
            defaultValue={row.value}
            rows={row.value.length > 90 || row.value.includes('\n') ? 3 : 1}
            className="mt-2 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-pine"
          />
        </>
      )}
    </div>
  )
}

export function ImportAnswersPanel({ clientId }: { clientId: number }) {
  const [state, action] = useActionState(importAnswersAction, emptyImportState)

  const rows = state.rows ?? []
  const writable = rows.filter((r) => r.key && r.action !== 'same')
  const unmatched = rows.filter((r) => r.action === 'unmatched').length

  return (
    <section className="rounded-lg border border-line bg-card p-5">
      <h2 className="display text-xl">Paste the answers back in</h2>
      <p className="mt-1 text-sm text-ink-3">
        Once the client has filled the form in, copy their response out of the Google Sheet and
        paste it here. Each answer is matched to its question and shown before anything is
        written.
      </p>

      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="clientId" value={clientId} />

        <textarea
          name="pasted"
          rows={5}
          placeholder={
            'Paste the header row and the response row from the sheet, or the questions and ' +
            'answers from a single response.'
          }
          className="w-full rounded-lg border border-line bg-sink/40 px-3 py-2 font-mono text-xs outline-none focus:border-pine"
        />

        <div className="flex flex-wrap items-center gap-3">
          <Submit idle="Read the answers" busy="Reading…" />
          <span className="text-xs text-ink-3">Nothing is saved by this.</span>
        </div>

        {state.error && (
          <p className="rounded border border-rose/30 bg-rose-soft p-3 text-sm whitespace-pre-wrap">
            {state.error}
          </p>
        )}
        {state.notice && (
          <p className="rounded border border-pine/30 bg-pine-soft p-3 text-sm">{state.notice}</p>
        )}
      </form>

      {rows.length > 0 && (
        <form action={action} className="mt-6 border-t border-line pt-5">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="intent" value="save" />
          <input
            type="hidden"
            name="keys"
            value={writable.map((r) => r.key).join(',')}
          />

          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="display text-lg">What was found</h3>
            <p className="text-sm text-ink-3">
              {state.responses > 1 && `${state.responses} responses pasted, using the newest. `}
              {writable.length} to write
              {unmatched > 0 && `, ${unmatched} not recognised`}.
            </p>
          </div>

          <div className="mt-4">
            {rows.map((row, i) => (
              <Row key={`${row.key ?? 'x'}-${i}`} row={row} />
            ))}
          </div>

          {writable.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Submit
                idle={`Save ${writable.length} answer${writable.length === 1 ? '' : 's'}`}
                busy="Saving…"
                primary
              />
              <span className="text-sm text-ink-3">
                Edit anything above first — what is on screen is what gets written.
              </span>
            </div>
          )}
        </form>
      )}
    </section>
  )
}
