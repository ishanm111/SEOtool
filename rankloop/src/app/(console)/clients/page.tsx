import Link from 'next/link'
import { listClientCards } from '@/lib/run-queries'
import { PageHeader, Empty } from '../_components/ui'
import { ClientCard } from '../_components/client-card'
import { StartMany } from '../_components/start-many'
import { AutoRefresh } from '../_components/auto-refresh'
import { MAX_PARALLEL_RUNS } from '@/lib/runner'

export const dynamic = 'force-dynamic'

/**
 * The book of business.
 *
 * One card per client, each carrying the two numbers that decide whether it
 * needs attention — how often the engines name them, and how many critical
 * findings are outstanding — and the button that starts the next run.
 */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string; deleted?: string }>
}) {
  const cards = listClientCards()
  const { added, deleted } = await searchParams
  const anyLive = cards.some((c) => c.activeRun)

  return (
    <div>
      <AutoRefresh active={anyLive} everyMs={5000} />
      <PageHeader
        title="Clients"
        subtitle="Every business the tool tracks. Add one by pointing it at a website and a Google listing — everything else is read off those."
        actions={
          <Link href="/clients/new" className="btn btn-primary">
            + Add a client
          </Link>
        }
      />

      {deleted && (
        <div className="mb-6 rounded-xl border border-line bg-sink p-4 text-sm text-ink-2">
          {deleted} was deleted, along with everything measured for them.
        </div>
      )}

      {added && (
        <div className="mb-6 rounded-xl border border-moss/25 bg-moss-soft p-4 text-sm text-moss-deep">
          Client saved and now being viewed. Start a run to measure them.
        </div>
      )}

      {cards.length === 0 ? (
        <Empty title="No clients yet">
          Add the first one and the tool works out the platform, the services, the places served and
          the name variants the engines have to match.
          <div className="mt-4">
            <Link href="/clients/new" className="btn btn-primary">
              Add a client
            </Link>
          </div>
        </Empty>
      ) : (
        <>
          <StartMany
            maxParallel={MAX_PARALLEL_RUNS}
            clients={cards.map((c) => ({
              id: c.client.id,
              name: c.client.name,
              domain: c.client.domain,
              busy: c.activeRun ? `run #${c.activeRun.id} is already going` : null,
            }))}
          />
          <div className="grid gap-5 lg:grid-cols-2">
            {cards.map((c) => (
              <ClientCard key={c.client.id} card={c} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
