'use client'

import { useState, useTransition } from 'react'
import { expandTowns } from '../_actions/clients'
import type { ZipPlace } from '@/onboard/zip'

/**
 * The service area, typed as towns or as ZIP codes.
 *
 * ZIPs are how a business describes where it works, and how their existing
 * paperwork is written — but nothing downstream can use one. The questions put
 * to the engines read "best appliance repair in Pasadena", not "in 77502", and
 * the wrong-geography check compares place names. So a ZIP is turned into its
 * town as soon as it is typed, in the box itself, where the operator can see
 * what it became and correct a wrong one on the spot.
 *
 * The same expansion runs again on save, so a ZIP typed and submitted without
 * ever leaving the field is still stored as a town.
 */
export function TownsField({
  id,
  name,
  defaultValue,
  rows = 3,
}: {
  id: string
  name: string
  defaultValue: string
  rows?: number
}) {
  const [value, setValue] = useState(defaultValue)
  const [resolved, setResolved] = useState<ZipPlace[]>([])
  const [unresolved, setUnresolved] = useState<string[]>([])
  const [pending, startTransition] = useTransition()

  const hasZip = /(^|,)\s*\d{5}(-\d{4})?\s*(,|$)/.test(value)

  const expand = () => {
    if (!hasZip) return
    const typed = value
    startTransition(async () => {
      const result = await expandTowns(typed)
      /**
       * A ZIP that could not be looked up stays in the box.
       *
       * Quietly dropping it would take a chunk of the service area with it, and
       * the operator would find out from a measurement that never asked about
       * that town. Left where it is, the save refuses until it is corrected.
       */
      const next = [result.towns, ...result.unresolved].filter(Boolean).join(', ')
      // Only applied if nothing was typed in the meantime — an answer arriving
      // after the operator has moved on must not overwrite what they wrote.
      setValue((current) => (current === typed ? next : current))
      setResolved(result.resolved)
      setUnresolved(result.unresolved)
    })
  }

  return (
    <div>
      <textarea
        id={id}
        name={name}
        rows={rows}
        className="field"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={expand}
        placeholder="Houston TX, Pasadena TX, 77502"
      />

      {pending && <p className="mt-1.5 text-xs text-ink-3">Looking up the ZIP codes…</p>}

      {resolved.length > 0 && (
        <p className="mt-1.5 text-xs text-moss-deep">
          {resolved.map((p) => `${p.zip} → ${p.name} ${p.state}`).join(' · ')}
        </p>
      )}

      {unresolved.length > 0 && (
        <p className="mt-1.5 text-xs text-rose">
          No town found for {unresolved.join(', ')}. It is still in the box and the save will
          refuse it — check the number, or type the town name instead. The questions are asked by
          town name, so a ZIP with nothing behind it has nothing to ask about.
        </p>
      )}

      {hasZip && !pending && resolved.length === 0 && unresolved.length === 0 && (
        <p className="mt-1.5 text-xs text-ink-3">
          ZIP codes are turned into town names when you leave this box.
        </p>
      )}
    </div>
  )
}
