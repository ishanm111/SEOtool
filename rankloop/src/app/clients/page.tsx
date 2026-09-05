import Link from 'next/link'
import { listClientCards } from '@/lib/run-queries'
import { PageHeader, Empty } from '../_components/ui'
import { ClientCard } from '../_components/client-card'
import { AutoRefresh } from '../_components/auto-refresh'

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
  searchParams: Promise<{ added?: string }>
}) {
  const cards = listClientCards()
  const { added } = await searchParams
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
        <div className="grid gap-5 lg:grid-cols-2">
          {cards.map((c) => (
            <ClientCard key={c.client.id} card={c} />
          ))}
        </div>
      )}
    </div>
  )
}
