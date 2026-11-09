'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { makeGoogleFormAction } from '../_actions/questionnaire-form'
import { emptyFormState } from '../_actions/questionnaire-form-state'
import { CopyLink } from '../_components/copy-link'

/**
 * Making the questionnaire into something the client can fill in themselves.
 *
 * The link, once it exists, is the whole point of this panel: it is copied into
 * a text message far more often than it is clicked, so copying is the primary
 * action and opening the form is secondary.
 */

function Submit({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending && <span className="h-1.5 w-1.5 rounded-full bg-current live-dot" aria-hidden />}
      {pending ? busy : idle}
    </button>
  )
}

export function GoogleFormPanel({
  clientId,
  clientName,
  pendingCount,
  existing,
  configured,
  configuredReason,
}: {
  clientId: number
  clientName: string
  pendingCount: number
  existing: { url: string; editUrl: string | null; madeAt: string | null } | null
  configured: boolean
  configuredReason?: string
}) {
  const [state, action] = useActionState(makeGoogleFormAction, emptyFormState)
  const [confirming, setConfirming] = useState(false)

  return (
    <section className="rounded-lg border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="display text-xl">Send it to the client</h2>
          <p className="mt-1 text-sm text-ink-3">
            {existing
              ? `A form for ${clientName} is live. Send them the link; answers land in the form's own responses sheet.`
              : `Turns the ${pendingCount} unanswered question${pendingCount === 1 ? '' : 's'} above into a Google Form ${clientName} can fill in on their phone.`}
          </p>
        </div>

        {!existing && configured && pendingCount > 0 && (
          <form action={action}>
            <input type="hidden" name="clientId" value={clientId} />
            <Submit idle="Make into Google Form" busy="Making the form…" />
          </form>
        )}
      </div>

      {!configured && (
        <p className="mt-4 rounded border border-amber/25 bg-amber-soft p-3 text-sm">
          Google is not connected yet. Run <code className="text-xs">npm run forms-auth</code> once,
          restart the server, and this button appears.
          {configuredReason && (
            <span className="mt-1 block text-xs text-ink-3">{configuredReason}</span>
          )}
        </p>
      )}

      {configured && !existing && pendingCount === 0 && (
        <p className="mt-4 text-sm text-ink-3">
          Every question is already answered, so there is nothing to ask.
        </p>
      )}

      {state.error && (
        <p className="mt-4 rounded border border-rose/30 bg-rose-soft p-3 text-sm whitespace-pre-wrap">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className="mt-4 rounded border border-pine/30 bg-pine-soft p-3 text-sm">{state.notice}</p>
      )}

      {existing && (
        <div className="mt-4 space-y-3">
          <div className="rounded border border-line bg-sink/50 p-3">
            <div className="eyebrow mb-1">Link for the client</div>
            <a
              href={existing.url}
              target="_blank"
              rel="noreferrer"
              className="block break-all text-sm text-pine underline"
            >
              {existing.url}
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <CopyLink url={existing.url} />
            {existing.editUrl && (
              <a href={existing.editUrl} target="_blank" rel="noreferrer" className="btn">
                Open in Google
              </a>
            )}
            {!confirming ? (
              <button type="button" className="btn text-ink-3" onClick={() => setConfirming(true)}>
                Replace it
              </button>
            ) : (
              <form action={action} className="flex items-center gap-2">
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="regenerate" value="yes" />
                <span className="text-sm text-ink-2">
                  The old link stops being the one you track. Sure?
                </span>
                <Submit idle="Make a new one" busy="Making…" />
                <button type="button" className="btn" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </form>
            )}
          </div>

          {existing.madeAt && <p className="text-xs text-ink-3">Made {existing.madeAt}.</p>}
        </div>
      )}
    </section>
  )
}
