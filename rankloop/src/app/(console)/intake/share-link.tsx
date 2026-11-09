'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { issueQuestionnaireLinkAction } from '../_actions/questionnaire-link'
import { emptyFormState } from '../_actions/questionnaire-form-state'
import { CopyLink } from '../_components/copy-link'

/**
 * The link the business fills the questionnaire in on.
 *
 * Offered before the Google Form panel because it is the shorter path by a
 * wide margin — nothing to set up, and the answers arrive in the questionnaire
 * above instead of a spreadsheet somebody has to copy out by hand.
 *
 * The one thing it needs is for the tool to be reachable from the client's
 * phone, which on a laptop it is not. That is said here rather than discovered
 * by a client tapping a dead link, and it is the same requirement the client
 * portal already has.
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

export function ShareLinkPanel({
  clientId,
  clientName,
  url,
  madeAt,
  answeredAt,
  localOnly,
  baseUrl,
}: {
  clientId: number
  clientName: string
  url: string | null
  madeAt: string | null
  answeredAt: string | null
  localOnly: boolean
  baseUrl: string
}) {
  const [state, action] = useActionState(issueQuestionnaireLinkAction, emptyFormState)
  const [confirming, setConfirming] = useState(false)

  return (
    <section className="rounded-lg border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="display text-xl">Let the client answer it themselves</h2>
          <p className="mt-1 text-sm text-ink-3">
            {url
              ? `${clientName} has a link. Whatever they type lands in the questionnaire above — there is nothing to copy back.`
              : `Makes a link ${clientName} can open on their phone. Their answers write straight into the questionnaire above. No Google account, nothing to connect.`}
          </p>
        </div>

        {!url && (
          <form action={action}>
            <input type="hidden" name="clientId" value={clientId} />
            <Submit idle="Make a link" busy="Making the link…" />
          </form>
        )}
      </div>

      {state.error && (
        <p className="mt-4 rounded border border-rose/30 bg-rose-soft p-3 text-sm whitespace-pre-wrap">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className="mt-4 rounded border border-pine/30 bg-pine-soft p-3 text-sm">
          {state.notice}
        </p>
      )}

      {url && (
        <div className="mt-4 space-y-3">
          <div className="rounded border border-line bg-sink/50 p-3">
            <div className="eyebrow mb-1">Link for the client</div>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="block break-all text-sm text-pine underline"
            >
              {url}
            </a>
          </div>

          {localOnly && (
            <p className="rounded border border-amber/25 bg-amber-soft p-3 text-sm">
              This link only opens on the machine the tool is running on, so it works for you and
              not for the client. Put the app somewhere they can reach it — a tunnel is enough —
              and set <code className="text-xs">PUBLIC_BASE_URL</code> in{' '}
              <code className="text-xs">.env.local</code> to that address. The client portal needs
              the same thing, so this is one job, not two.
              <span className="mt-2 block text-xs text-ink-3">
                Currently sending people to {baseUrl}.
              </span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <CopyLink url={url} />
            <a href={url} target="_blank" rel="noreferrer" className="btn">
              Open it
            </a>
            {!confirming ? (
              <button type="button" className="btn text-ink-3" onClick={() => setConfirming(true)}>
                Replace it
              </button>
            ) : (
              <form action={action} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="regenerate" value="yes" />
                <span className="text-sm text-ink-2">
                  The old link stops working the moment this is pressed. Sure?
                </span>
                <Submit idle="Make a new one" busy="Making…" />
                <button type="button" className="btn" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </form>
            )}
          </div>

          <p className="text-xs text-ink-3">
            {madeAt && `Made ${madeAt}. `}
            {answeredAt
              ? `Last answered ${answeredAt}.`
              : 'Not opened and answered yet.'}
          </p>
        </div>
      )}
    </section>
  )
}
