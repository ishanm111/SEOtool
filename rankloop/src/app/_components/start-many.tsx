'use client'

import { useActionState, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { startRunsAction, type BatchFormState } from '../_actions/runs'
import { DESK_STEP_KEYS, PIPELINE } from '@/lib/pipeline'

/**
 * "Run several clients", in one press.
 *
 * The alternative this replaces is opening each client, starting it, and coming
 * back in an hour to start the next — which is how a book of ten businesses
 * turns into a week of babysitting. Everything that can happen at the same time
 * now does; the one thing that cannot say so on the panel rather than surprising
 * the operator later.
 */

const ENGINES = [
  { key: 'chatgpt', label: 'ChatGPT' },
  { key: 'perplexity', label: 'Perplexity' },
  { key: 'gemini', label: 'Gemini' },
]

export type BatchClient = {
  id: number
  name: string
  domain: string
  /** Why this one cannot be started, or null if it can. */
  busy: string | null
}

function Go() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending && (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current live-dot" aria-hidden />
      )}
      {pending ? 'Starting…' : 'Start the ticked clients'}
    </button>
  )
}

export function StartMany({
  clients,
  maxParallel,
}: {
  clients: BatchClient[]
  maxParallel: number
}) {
  const [state, action] = useActionState<BatchFormState, FormData>(startRunsAction, {
    error: null,
    refused: [],
  })
  const form = useRef<HTMLFormElement>(null)

  const available = clients.filter((c) => !c.busy)

  /**
   * Ticking twelve boxes by hand is the reason a batch button goes unused, so
   * this is done to the DOM rather than by making every checkbox controlled —
   * the form is uncontrolled everywhere else and there is nothing here worth
   * holding in React state.
   */
  const setAll = (checked: boolean) => {
    const boxes = form.current?.querySelectorAll<HTMLInputElement>('input[name="clientIds"]')
    boxes?.forEach((box) => {
      if (!box.disabled) box.checked = checked
    })
  }

  if (available.length < 2) return null

  return (
    <details className="card mb-6 overflow-hidden">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-5 py-4 marker:content-none">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Run several clients at once</span>
          <span className="block text-sm text-ink-3">
            {maxParallel} go at a time and the rest queue themselves. Only the “ask the engines”
            step takes turns, because there is one signed-in browser.
          </span>
        </span>
        <span className="btn btn-secondary btn-sm shrink-0">Set one up</span>
      </summary>

      <form ref={form} action={action} className="border-t border-line px-5 py-5">
        <div className="grid gap-6 lg:grid-cols-2">
          <fieldset>
            <legend className="field-label">Which clients</legend>
            <div className="mb-2 flex gap-3 text-xs">
              <button
                type="button"
                onClick={() => setAll(true)}
                className="text-pine hover:underline"
              >
                Tick all {available.length}
              </button>
              <button
                type="button"
                onClick={() => setAll(false)}
                className="text-ink-3 hover:underline"
              >
                Clear
              </button>
            </div>
            <div className="max-h-72 space-y-1 overflow-auto rounded-lg border border-line p-2">
              {clients.map((c) => (
                <label
                  key={c.id}
                  className={`flex items-start gap-2 rounded-lg p-2 text-sm ${
                    c.busy ? 'opacity-50' : 'cursor-pointer hover:bg-sink'
                  }`}
                >
                  <input
                    type="checkbox"
                    name="clientIds"
                    value={c.id}
                    disabled={Boolean(c.busy)}
                    className="mt-1"
                  />
                  <input type="hidden" name="clientNames" value={`${c.id}:${c.name}`} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-ink-3">
                      {c.busy ?? c.domain}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-5">
            <fieldset>
              <legend className="field-label">What to run for each of them</legend>
              <label className="flex cursor-pointer gap-2 rounded-lg p-2 text-sm hover:bg-sink">
                <input type="radio" name="preset" value="full" defaultChecked className="mt-1" />
                <span>
                  <span className="font-semibold">Everything</span>
                  <span className="block text-xs text-ink-3">
                    Reading the sites happens side by side; the engine questions queue up behind
                    each other, so allow about an hour per client for that step alone.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-2 rounded-lg p-2 text-sm hover:bg-sink">
                <input type="radio" name="preset" value="desk" className="mt-1" />
                <span>
                  <span className="font-semibold">Skip the engines</span>
                  <span className="block text-xs text-ink-3">
                    {DESK_STEP_KEYS.length} steps against answers already collected. Nothing here
                    needs the browser, so the whole batch runs in parallel.
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
                    Multiplies the slowest step by the number of clients. Off unless a batch is
                    being left overnight.
                  </span>
                </span>
              </label>
            </fieldset>

            <div className="border-t border-line pt-4">
              <label htmlFor="batch-label" className="field-label">
                Label every run (optional)
              </label>
              <input
                id="batch-label"
                name="label"
                className="field"
                placeholder="e.g. September sweep"
              />
            </div>
          </div>
        </div>

        {state.error && (
          <p className="mt-4 rounded-lg border border-rose/25 bg-rose-soft p-3 text-sm text-rose">
            {state.error}
          </p>
        )}

        {state.refused.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber/25 bg-amber-soft p-3 text-sm">
            <p className="font-semibold text-ink">
              {state.refused.length} of them did not start
              {state.error ? '' : ' — the rest did'}
            </p>
            <ul className="mt-1 space-y-0.5 text-ink-2">
              {state.refused.map((r) => (
                <li key={r.name}>
                  <span className="font-medium">{r.name}</span> — {r.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
          <Go />
          <span className="text-xs text-ink-3">
            Every run is watchable on the runs page while it goes.
          </span>
        </div>
      </form>
    </details>
  )
}
