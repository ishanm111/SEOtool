'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { startRunAction, type RunFormState } from '../_actions/runs'
import { DESK_STEP_KEYS, PIPELINE } from '@/lib/pipeline'

/**
 * "Start a new run", with the choices that actually change what happens.
 *
 * The defaults are the common case — everything, core questions only — and the
 * options stay folded away, because a run that needs five decisions before it
 * starts is a run nobody starts.
 */

const ENGINES = [
  { key: 'chatgpt', label: 'ChatGPT' },
  { key: 'perplexity', label: 'Perplexity' },
  { key: 'gemini', label: 'Gemini' },
]

function Go({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending && (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current live-dot" aria-hidden />
      )}
      {pending ? 'Starting…' : label}
    </button>
  )
}

export function StartRun({
  clientId,
  clientName,
  disabled,
  disabledReason,
}: {
  clientId: number
  clientName: string
  disabled?: boolean
  disabledReason?: string
}) {
  const [state, action] = useActionState<RunFormState, FormData>(startRunAction, { error: null })

  if (disabled) {
    return (
      <span className="text-xs text-ink-3" title={disabledReason}>
        {disabledReason}
      </span>
    )
  }

  return (
    <details className="group relative">
      <summary className="btn btn-primary list-none marker:content-none">
        Start a new run
        <span className="text-xs opacity-70 transition group-open:rotate-180">▾</span>
      </summary>

      <form
        action={action}
        className="card absolute right-0 z-20 mt-2 w-[22rem] max-w-[calc(100vw-3rem)] space-y-4 p-5 text-left"
      >
        <input type="hidden" name="clientId" value={clientId} />

        <div>
          <p className="display text-base">Run for {clientName}</p>
          <p className="mt-0.5 text-xs text-ink-3">
            Each step runs the same script the command line runs, in order, and stops at the first
            failure.
          </p>
        </div>

        <fieldset>
          <legend className="field-label">What to run</legend>
          <label className="flex cursor-pointer gap-2 rounded-lg p-2 text-sm hover:bg-sink">
            <input type="radio" name="preset" value="full" defaultChecked className="mt-1" />
            <span>
              <span className="font-semibold">Everything</span>
              <span className="block text-xs text-ink-3">
                Read the site, ask the engines, profile competitors, rebuild the report.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer gap-2 rounded-lg p-2 text-sm hover:bg-sink">
            <input type="radio" name="preset" value="desk" className="mt-1" />
            <span>
              <span className="font-semibold">Skip the engines</span>
              <span className="block text-xs text-ink-3">
                Re-runs {DESK_STEP_KEYS.length} steps against answers already collected. Minutes,
                not hours, and needs no signed-in browser.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer gap-2 rounded-lg p-2 text-sm hover:bg-sink">
            <input type="radio" name="preset" value="custom" className="mt-1" />
            <span className="font-semibold">Pick the steps</span>
          </label>
          <div className="mt-1 space-y-1 border-l-2 border-line pl-4">
            {PIPELINE.map((s) => (
              <label key={s.key} className="flex items-start gap-2 text-xs text-ink-2">
                <input type="checkbox" name="steps" value={s.key} className="mt-0.5" />
                <span>
                  {s.label}
                  <span className="text-ink-3"> · {s.duration}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="border-t border-line pt-4">
          <legend className="field-label">Engines to ask</legend>
          <div className="flex flex-wrap gap-3">
            {ENGINES.map((e) => (
              <label key={e.key} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="engines" value={e.key} defaultChecked />
                {e.label}
              </label>
            ))}
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" name="depth" value="full" className="mt-1" />
            <span>
              Ask every question
              <span className="block text-xs text-ink-3">
                Off by default: the core subset is a fraction of the time and moves the same number.
              </span>
            </span>
          </label>
        </fieldset>

        <div className="border-t border-line pt-4">
          <label htmlFor={`label-${clientId}`} className="field-label">
            Label (optional)
          </label>
          <input
            id={`label-${clientId}`}
            name="label"
            className="field"
            placeholder="e.g. after the homepage rewrite"
          />
        </div>

        {state.error && (
          <p className="rounded-lg border border-rose/25 bg-rose-soft p-3 text-sm text-rose">
            {state.error}
          </p>
        )}

        <Go label="Start run" />
      </form>
    </details>
  )
}
