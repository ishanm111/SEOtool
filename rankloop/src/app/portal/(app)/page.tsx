import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentPortalSession } from '@/portal/auth'
import { getOverview } from '@/lib/queries'
import { portalFixes, tallyDecisions } from '@/portal/queries'
import { Empty, PortalHeader, Stat } from '../_components/ui'

export const dynamic = 'force-dynamic'

/**
 * The one screen a client opens most: where they stand, and what is waiting on
 * them.
 *
 * Ordered by what the owner can act on. The visibility number is the headline
 * because it is the thing they are paying to move, and the decisions still
 * pending come second because they are the only thing on this page that is
 * blocked on the person reading it.
 */
export default async function PortalOverview() {
  const session = await currentPortalSession()
  if (!session) redirect('/portal/login')

  const overview = getOverview(session.client)
  const fixes = portalFixes(session.client)
  const tally = tallyDecisions(fixes)

  if (overview.totalAnswers === 0) {
    return (
      <div className="space-y-6">
        <PortalHeader title="Overview" />
        <Empty title="Nothing has been measured yet.">
          Once your first run finishes, this page shows how often AI assistants name{' '}
          {session.client.name}.
        </Empty>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <PortalHeader
        title="Overview"
        lede={`How often AI assistants name ${session.client.name} when someone asks for a business like yours.`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Named in AI"
          value={`${overview.pct}%`}
          note={`${overview.named} of ${overview.totalAnswers} answers`}
        />
        <Stat
          label="Things to fix"
          value={overview.findingCount}
          note={`${overview.criticalCount} need attention first`}
        />
        <Stat
          label="Changes written"
          value={fixes.length}
          note={`${tally.approved} approved, ${tally.rejected} declined`}
        />
        <Stat label="Waiting on you" value={tally.pending} note="proposed changes to review" />
      </div>

      {tally.pending > 0 && (
        <div className="rounded-lg border border-amber/25 bg-amber-soft p-5">
          <p className="text-sm font-medium">
            {tally.pending} proposed {tally.pending === 1 ? 'change is' : 'changes are'} waiting for
            your approval.
          </p>
          <p className="mt-1 text-sm text-ink-2">
            Nothing is published to your website until you approve it.
          </p>
          <Link href="/portal/fixes" className="btn btn-primary mt-3 inline-flex">
            Review them
          </Link>
        </div>
      )}

      {overview.engines.length > 0 && (
        <section className="space-y-3">
          <h2 className="display text-xl">Where you stand, by assistant</h2>
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-sink text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Assistant</th>
                  <th className="px-4 py-2 font-medium">Answers</th>
                  <th className="px-4 py-2 font-medium">Named you</th>
                </tr>
              </thead>
              <tbody>
                {overview.engines.map((e) => (
                  <tr key={e.engine} className="border-t border-line">
                    <td className="px-4 py-2 capitalize">{e.engine}</td>
                    <td className="px-4 py-2">{e.ok}</td>
                    <td className="px-4 py-2">
                      {e.named}
                      <span className="ml-1 text-ink-3">
                        ({e.ok ? Math.round((e.named / e.ok) * 100) : 0}%)
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {overview.competitors.length > 0 && (
        <section className="space-y-3">
          <h2 className="display text-xl">Who gets named instead</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {overview.competitors.slice(0, 6).map(([name, count]) => (
              <li
                key={name}
                className="flex items-center justify-between rounded-lg border border-line bg-card px-4 py-2 text-sm"
              >
                <span className="truncate">{name}</span>
                <span className="text-ink-3">{count}×</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
