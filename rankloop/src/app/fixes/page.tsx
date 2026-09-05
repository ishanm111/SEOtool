import Link from 'next/link'
import { activeClient } from '@/lib/active-client'
import { listFixes } from '@/lib/fix-queries'
import { NoClient } from '../_components/no-client'
import { PageHeader, Stat, Empty } from '../_components/ui'
import { SiteConnection } from './connection'
import { FixCard } from './fix-card'

export const dynamic = 'force-dynamic'

/**
 * Publishing the fix list to the client's own website.
 *
 * Ordered by measured priority, and split into what can go live now and what is
 * waiting on something. Nothing is published in bulk: each change is approved on
 * its own, against the value it replaces.
 */
export default async function FixesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>
}) {
  const client = await activeClient()
  if (!client) return <NoClient />

  const { show } = await searchParams
  const { rows, credential, counts } = listFixes(client)

  const ready = rows.filter((r) => !r.blockedBecause && r.applied?.status !== 'applied')
  const applied = rows.filter((r) => r.applied?.status === 'applied')
  const blocked = rows.filter((r) => r.blockedBecause)

  const view = show === 'applied' ? applied : show === 'blocked' ? blocked : ready
  const viewLabel =
    show === 'applied' ? 'Published' : show === 'blocked' ? 'Waiting on something' : 'Ready to publish'

  return (
    <div className="space-y-8">
      <PageHeader
        title="Apply fixes"
        subtitle={`Approved changes written straight to ${client.domain}. Every edit records what was there before it, so any of them can be put back.`}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Fixes in total" value={counts.total} />
        <Stat
          label="Ready to publish"
          value={counts.ready}
          tone={counts.ready > 0 ? 'brand' : 'neutral'}
        />
        <Stat label="Published" value={counts.applied} tone={counts.applied > 0 ? 'good' : 'neutral'} />
        <Stat
          label="Waiting on something"
          value={counts.blocked}
          tone={counts.blocked > 0 ? 'warn' : 'neutral'}
        />
      </div>

      <SiteConnection
        clientId={client.id}
        clientPlatform={client.platform}
        clientDomain={client.domain}
        existing={
          credential
            ? {
                id: credential.id,
                kind: credential.kind,
                endpoint: credential.endpoint,
                username: credential.username,
                status: credential.status,
                detail: credential.detail,
              }
            : null
        }
      />

      <div>
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            { key: '', label: `Ready (${ready.length})` },
            { key: 'applied', label: `Published (${applied.length})` },
            { key: 'blocked', label: `Waiting (${blocked.length})` },
          ].map((tab) => {
            const isCurrent = (show ?? '') === tab.key
            return (
              <Link
                key={tab.key || 'ready'}
                href={tab.key ? `/fixes?show=${tab.key}` : '/fixes'}
                className={`btn btn-sm ${isCurrent ? 'btn-primary' : 'btn-secondary'}`}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>

        <h2 className="display mb-4 text-xl">{viewLabel}</h2>

        {rows.length === 0 ? (
          <Empty title="No fix list yet">
            The fix list is built by a run. Start one from the client, or run just the
            recommendations step if the site has already been read.
            <div className="mt-4">
              <Link href="/clients" className="btn btn-primary">
                Go to clients
              </Link>
            </div>
          </Empty>
        ) : view.length === 0 ? (
          <Empty title={`Nothing ${viewLabel.toLowerCase()}`}>
            {show === 'applied'
              ? 'No change has been published to this site yet.'
              : show === 'blocked'
                ? 'Every fix on the list can be published as it stands.'
                : counts.applied === counts.total
                  ? 'Every fix has been published.'
                  : 'Connect the website above, or fill in the values the blocked fixes are waiting on.'}
          </Empty>
        ) : (
          <div className="space-y-5">
            {view.map((fix) => (
              <FixCard key={fix.id} fix={fix} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
