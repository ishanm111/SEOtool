'use client'

import { useState } from 'react'
import { US_STATE_OPTIONS, normaliseState } from '@/onboard/us-states'

/**
 * The states a business actually serves, picked from a list rather than typed.
 *
 * This is the field detection cannot decide and the operator must. It also sets
 * which place names count as wrong-geography, so "TZ" typed for "TX" does not
 * read as a typo anywhere downstream — it reads as a business that serves
 * nowhere, and quietly changes every finding after it.
 *
 * The value still leaves as the comma-separated string the server action has
 * always parsed, so nothing behind the form had to learn a new shape.
 */
export function StatePicker({
  name,
  defaultValue,
  /** States the site itself mentioned, offered as one-press additions. */
  suggestions = [],
}: {
  name: string
  defaultValue: string
  suggestions?: { state: string; mentions: number }[]
}) {
  const [chosen, setChosen] = useState<string[]>(() => parse(defaultValue))

  const add = (abbr: string) => {
    const state = normaliseState(abbr)
    if (!state) return
    setChosen((current) => (current.includes(state) ? current : [...current, state]))
  }
  const remove = (abbr: string) => setChosen((current) => current.filter((s) => s !== abbr))

  const unchosen = US_STATE_OPTIONS.filter((o) => !chosen.includes(o.abbr))
  const unsuggested = suggestions.filter((s) => !chosen.includes(s.state))

  return (
    <div>
      <input type="hidden" name={name} value={chosen.join(', ')} />

      {chosen.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {chosen.map((abbr) => (
            <li key={abbr}>
              <span className="pill bg-pine-soft text-pine-deep">
                {nameOf(abbr)}
                <button
                  type="button"
                  onClick={() => remove(abbr)}
                  className="ml-1.5 cursor-pointer opacity-60 hover:opacity-100"
                  aria-label={`Remove ${nameOf(abbr)}`}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <select
        className="field"
        value=""
        onChange={(e) => {
          add(e.target.value)
          e.target.value = ''
        }}
        aria-label="Add a state served"
      >
        <option value="">{chosen.length ? 'Add another state…' : 'Pick a state…'}</option>
        {unchosen.map((o) => (
          <option key={o.abbr} value={o.abbr}>
            {o.name} ({o.abbr})
          </option>
        ))}
      </select>

      {unsuggested.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
          Mentioned on the site:
          {unsuggested.map((s) => (
            <button
              key={s.state}
              type="button"
              onClick={() => add(s.state)}
              className="btn btn-secondary btn-sm"
            >
              + {nameOf(s.state)} · {s.mentions} mentions
            </button>
          ))}
        </p>
      )}
    </div>
  )
}

/** Accepts whatever was typed before this field became a list. */
function parse(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(',')) {
    const state = normaliseState(part)
    if (state && !out.includes(state)) out.push(state)
  }
  return out
}

const nameOf = (abbr: string) =>
  US_STATE_OPTIONS.find((o) => o.abbr === abbr)?.name ?? abbr
