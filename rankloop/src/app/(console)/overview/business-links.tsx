'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { businessLinksAction } from '../_actions/reinspect'
import { emptyReinspectState } from '../_actions/reinspect-state'

/**
 * Correcting the two links everything else is derived from, after the fact.
 *
 * Collapsed by default. It is needed rarely — a typo in an address, a Google
 * listing found a week later — and a permanently open form editing the one
 * field the whole audit hangs off is an invitation to change it by accident.
 */

function Submit({
  intent,
  idle,
  busy,
  variant = 'secondary',
}: {
  intent: 'save' | 'inspect'
  idle: string
  busy: string
  variant?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      className={`btn btn-${variant}`}
      disabled={pending}
    >
      {pending && <span className="h-1.5 w-1.5 rounded-full bg-current live-dot" aria-hidden />}
      {pending ? busy : idle}
    </button>
  )
}

export function BusinessLinks({
  clientId,
  homepageUrl,
  gbpUrl,
  hasRun,
}: {
  clientId: number
  homepageUrl: string
  gbpUrl: string | null
  hasRun: boolean
}) {
  const [open, setOpen] = useState(false)
  const [state, submit] = useActionState(businessLinksAction, emptyReinspectState)

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm text-ink-3">
        <span>
          {homepageUrl}
          {gbpUrl ? ' · Google listing on file' : ' · no Google listing'}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          Edit links
        </button>
      </div>
    )
  }

  return (
    <section className="rounded-lg border border-line bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="display text-xl">Website and Google listing</h2>
          <p className="mt-1 text-sm text-ink-3">
            Everything the tool knows is read from these two. Fix one and inspect the business
            again to re-read it.
          </p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      <form action={submit} className="mt-4 space-y-4">
        <input type="hidden" name="clientId" value={clientId} />

        <label className="block">
          <span className="eyebrow">Website address</span>
          <input
            name="websiteUrl"
            defaultValue={homepageUrl}
            required
            className="mt-1 w-full rounded border border-line bg-white px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="eyebrow">Google Business Profile link</span>
          <input
            name="googleProfileUrl"
            defaultValue={gbpUrl ?? ''}
            placeholder="Open the business in Google Maps, press Share, paste it here"
            className="mt-1 w-full rounded border border-line bg-white px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-ink-3">
            A maps.app.goo.gl or share.google address both work. Leave blank if the business has
            no listing.
          </span>
        </label>

        {state.error && (
          <p className="rounded border border-rose/30 bg-rose-soft p-3 text-sm">{state.error}</p>
        )}
        {state.notice && (
          <p className="rounded border border-pine/30 bg-pine-soft p-3 text-sm">{state.notice}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Submit intent="save" idle="Save links" busy="Saving…" />
          <Submit
            intent="inspect"
            idle="Inspect the business again"
            busy="Reading the site…"
            variant="primary"
          />
        </div>

        <p className="text-xs text-ink-3">
          Inspecting re-reads the platform, phone numbers, offerings and the Google listing. It
          leaves the name, the towns and the business type alone — those are yours.
          {hasRun && ' Existing measurements are untouched; re-run ingest to pick up new pages.'}
        </p>
      </form>
    </section>
  )
}
