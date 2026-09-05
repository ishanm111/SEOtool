'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  saveCredentialAction,
  testCredentialAction,
  disconnectAction,
  emptyFixState,
  type FixState,
} from '../_actions/fixes'
import { StatusTag } from '../_components/ui'

/**
 * Connecting the client's own website so approved fixes can be published.
 *
 * The credential is an application password or an API token, never a login, and
 * the wording says so — an operator asking a client for access has to be able to
 * explain exactly what they are handing over and how to take it back.
 */

type Existing = {
  id: number
  kind: string
  endpoint: string
  username: string
  status: string
  detail: string | null
} | null

function Submit({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending && <span className="h-1.5 w-1.5 rounded-full bg-current live-dot" aria-hidden />}
      {pending ? busy : idle}
    </button>
  )
}

export function SiteConnection({
  clientId,
  clientPlatform,
  clientDomain,
  existing,
}: {
  clientId: number
  clientPlatform: string
  clientDomain: string
  existing: Existing
}) {
  const [kind, setKind] = useState(
    existing?.kind ?? (clientPlatform === 'shopify' ? 'shopify' : 'wordpress'),
  )
  const [saveState, save] = useActionState<FixState, FormData>(saveCredentialAction, emptyFixState)
  const [testState, test] = useActionState<FixState, FormData>(testCredentialAction, emptyFixState)

  const state = saveState.error || saveState.notice ? saveState : testState

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="display text-lg">Website access</h2>
          <p className="mt-0.5 text-sm text-ink-3">
            {existing
              ? `Connected to ${existing.endpoint}`
              : 'Connect the site and approved fixes publish from here instead of being copied out by hand.'}
          </p>
        </div>
        {existing && <StatusTag status={existing.status} />}
      </header>

      <div className="p-5">
        {existing?.detail && (
          <p
            className={`mb-4 rounded-lg border p-3 text-sm ${
              existing.status === 'ok'
                ? 'border-moss/25 bg-moss-soft text-moss-deep'
                : 'border-rose/25 bg-rose-soft text-rose'
            }`}
          >
            {existing.detail}
          </p>
        )}

        <details open={!existing}>
          <summary className="cursor-pointer text-sm font-semibold text-pine-deep">
            {existing ? 'Change these details' : 'Set up access'}
          </summary>

          <form action={save} className="mt-4 space-y-5">
            <input type="hidden" name="clientId" value={clientId} />

            <div>
              <span className="field-label">Platform</span>
              <div className="flex gap-4">
                {[
                  { value: 'wordpress', label: 'WordPress' },
                  { value: 'shopify', label: 'Shopify' },
                ].map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="kind"
                      value={o.value}
                      checked={kind === o.value}
                      onChange={() => setKind(o.value)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>

            {kind === 'wordpress' ? (
              <>
                <div>
                  <label htmlFor="endpoint" className="field-label">
                    WordPress address
                  </label>
                  <input
                    id="endpoint"
                    name="endpoint"
                    className="field"
                    defaultValue={existing?.endpoint ?? `https://${clientDomain}`}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="username" className="field-label">
                      Username
                    </label>
                    <input
                      id="username"
                      name="username"
                      className="field"
                      autoComplete="off"
                      defaultValue={existing?.username ?? ''}
                    />
                  </div>
                  <div>
                    <label htmlFor="secret" className="field-label">
                      Application password
                    </label>
                    <input
                      id="secret"
                      name="secret"
                      type="password"
                      className="field"
                      autoComplete="new-password"
                      placeholder={existing ? 'leave blank to keep the current one' : 'xxxx xxxx xxxx xxxx'}
                    />
                  </div>
                </div>
                <p className="text-xs text-ink-3">
                  In WordPress: Users → Profile → Application Passwords. It cannot be used to sign
                  into wp-admin, and the client can revoke it from that same screen at any time. The
                  account needs to be an Editor or an Administrator.
                </p>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="endpoint" className="field-label">
                    Store address
                  </label>
                  <input
                    id="endpoint"
                    name="endpoint"
                    className="field"
                    placeholder="your-store.myshopify.com"
                    defaultValue={existing?.endpoint ?? ''}
                  />
                </div>
                <div>
                  <label htmlFor="secret" className="field-label">
                    Admin API access token
                  </label>
                  <input
                    id="secret"
                    name="secret"
                    type="password"
                    className="field"
                    autoComplete="new-password"
                    placeholder={existing ? 'leave blank to keep the current one' : 'shpat_…'}
                  />
                </div>
                <input type="hidden" name="username" value="" />
                <p className="text-xs text-ink-3">
                  In Shopify: Settings → Apps and sales channels → Develop apps → create an app, give
                  it read and write access to products, then install it and copy the Admin API access
                  token. Uninstalling the app revokes it.
                </p>
              </>
            )}

            <div className="flex items-center gap-2 border-t border-line pt-4">
              <Submit idle="Save and test" busy="Testing…" />
              {existing && (
                <>
                  <button
                    type="submit"
                    formAction={test}
                    name="credentialId"
                    value={existing.id}
                    className="btn btn-secondary"
                  >
                    Test again
                  </button>
                  <button
                    type="submit"
                    formAction={disconnectAction}
                    name="credentialId"
                    value={existing.id}
                    className="btn btn-danger"
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </form>
        </details>

        {state.error && (
          <p className="mt-4 rounded-lg border border-rose/25 bg-rose-soft p-3 text-sm text-rose">
            {state.error}
          </p>
        )}
        {state.notice && (
          <p className="mt-4 rounded-lg border border-moss/25 bg-moss-soft p-3 text-sm text-moss-deep">
            {state.notice}
          </p>
        )}
      </div>
    </section>
  )
}
