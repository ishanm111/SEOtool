'use client'

import { useLayoutEffect, useRef, useState } from 'react'

/**
 * A questionnaire field that finishes the sentence when you press Tab.
 *
 * The completion is grey, sits behind the caret, and is only ever a *frame*:
 * every number, price, period and issuing body in one is an ellipsis the
 * operator has to fill. That restraint is the point. This questionnaire exists
 * because the tool refuses to state a price or a warranty it was not told, and
 * a suggestion reading "90 days on labour" would smuggle exactly that claim in
 * through the one door built to keep it out.
 *
 * What it does save is the shape of a good answer: the units, the second half
 * that gets forgotten, the "and what changes it" a bare price leaves out.
 *
 * Tab takes the suggestion and selects the first blank, so the next thing typed
 * lands where a real number has to go. Escape dismisses it. Tab does nothing
 * unusual when there is no suggestion showing, so it still moves between fields.
 */
export function SuggestingField({
  id,
  name,
  kind,
  placeholder,
  defaultValue,
  suggestions,
}: {
  id: string
  name: string
  kind: 'text' | 'textarea'
  placeholder?: string
  defaultValue: string
  suggestions: string[]
}) {
  const [value, setValue] = useState(defaultValue)
  const [dismissed, setDismissed] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  /**
   * Matching runs on the current line, not the whole box.
   *
   * Several of these answers are lists, and a second line typed under a first
   * would otherwise never match anything.
   */
  const lineStart = value.lastIndexOf('\n') + 1
  const line = value.slice(lineStart)

  const match =
    dismissed || !focused
      ? null
      : (suggestions.find(
          (s) =>
            s.toLowerCase().startsWith(line.toLowerCase()) &&
            s.length > line.length &&
            // An empty box offers the first frame; a part-typed line only
            // matches once there is enough of it to have meant something.
            (line.length === 0 || line.trim().length >= 2),
        ) ?? null)

  const ghost = match ? match.slice(line.length) : ''

  /**
   * Where the caret goes once the suggestion is in.
   *
   * Applied after the field has re-rendered rather than during the keypress —
   * a controlled field puts the caret back at the end when its value changes,
   * so a selection made before that lands nowhere.
   */
  const caret = useRef<[number, number] | null>(null)
  useLayoutEffect(() => {
    const target = caret.current
    if (!target) return
    caret.current = null
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(target[0], target[1])
  }, [value])

  const accept = () => {
    if (!match) return
    const next = value.slice(0, lineStart) + match
    setValue(next)
    // The caret lands on the first blank rather than at the end: what the
    // operator has to supply is the number, and the frame is already written.
    const blank = next.indexOf('…', lineStart)
    caret.current = blank >= 0 ? [blank, blank + 1] : [next.length, next.length]
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && ghost && !e.shiftKey) {
      e.preventDefault()
      accept()
      return
    }
    if (e.key === 'Escape' && ghost) {
      e.preventDefault()
      setDismissed(true)
    }
  }

  const shared = {
    id,
    name,
    className: 'field relative bg-transparent',
    placeholder: ghost ? undefined : placeholder,
    value,
    onKeyDown,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValue(e.target.value)
      setDismissed(false)
    },
  }

  return (
    <div className="relative">
      {/*
        The grey completion is drawn by a copy of the field sitting behind it,
        holding the typed text invisibly so the suggestion starts exactly where
        the caret is. Same class, so the two can never disagree about padding,
        border width or font size — which is the only way this stays aligned as
        the styles change.
      */}
      <div
        aria-hidden
        className={`field pointer-events-none absolute inset-0 overflow-hidden border-transparent bg-transparent ${
          kind === 'textarea' ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
        }`}
      >
        <span className="invisible">{value}</span>
        <span className="text-ink-3/70">{ghost}</span>
      </div>

      {kind === 'textarea' ? (
        <textarea {...shared} ref={ref as React.Ref<HTMLTextAreaElement>} rows={2} />
      ) : (
        <input {...shared} ref={ref as React.Ref<HTMLInputElement>} />
      )}

      {ghost && (
        <p className="mt-1 text-xs text-ink-3">
          Press <kbd className="rounded border border-line px-1">Tab</kbd> to take that,{' '}
          <kbd className="rounded border border-line px-1">Esc</kbd> to dismiss it. The blanks are
          yours to fill — nothing in a suggestion is a fact about this business.
        </p>
      )}
    </div>
  )
}
