import { activeClient, allClients } from '@/lib/active-client'
import { NoClient } from '../_components/no-client'

export const dynamic = 'force-dynamic'

export default async function ClientsPage() {
  const clients = allClients()
  const active = await activeClient()
  if (clients.length === 0 || !active) return <NoClient />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Everything the tool detected from each site. Add another by pointing it at a URL.
        </p>
      </div>

      <div className="space-y-4">
        {clients.map((c) => {
          const aliases = JSON.parse(c.aliases || '[]') as string[]
          const phones = JSON.parse(c.phones || '[]') as string[]
          const offerings = JSON.parse(c.offerings || '[]') as string[]
          const wrongGeo = JSON.parse(c.wrongGeoTerms || '[]') as string[]
          const isActive = c.id === active.id

          return (
            <article
              key={c.id}
              className={`rounded-lg border bg-white p-5 ${
                isActive ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-zinc-200'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{c.name}</h2>
                {isActive && (
                  <span className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    viewing
                  </span>
                )}
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600">
                  {c.businessType.replace(/_/g, ' ')}
                </span>
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600">
                  {c.platform}
                </span>
              </div>

              <a
                href={c.homepageUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-zinc-500 hover:underline"
              >
                {c.domain}
              </a>

              <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Phones</dt>
                  <dd className={phones.length > 1 ? 'text-red-600' : ''}>
                    {phones.length ? phones.join(' · ') : '—'}
                    {phones.length > 1 && ' (inconsistent)'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    Google profile
                  </dt>
                  <dd>
                    {c.gbpRating !== null
                      ? `${c.gbpRating}★ · ${c.gbpReviewCount ?? '?'} reviews${
                          c.gbpHasWebsite === false ? ' · no website attached' : ''
                        }`
                      : '—'}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    {c.businessType === 'ecommerce' ? 'Categories' : 'Services'} ({offerings.length})
                  </dt>
                  <dd className="text-zinc-700">{offerings.slice(0, 14).join(', ') || '—'}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    Name variants used for matching ({aliases.length})
                  </dt>
                  <dd className="text-zinc-700">{aliases.join(' · ') || '—'}</dd>
                </div>
                {wrongGeo.length > 0 && (
                  <div className="sm:col-span-2">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-red-600">
                      Wrong-geography terms ({wrongGeo.length})
                    </dt>
                    <dd className="text-zinc-700">{wrongGeo.slice(0, 20).join(', ')}</dd>
                  </div>
                )}
              </dl>
            </article>
          )
        })}
      </div>

      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-5">
        <h2 className="text-sm font-semibold">Add a client</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Point it at a URL. It works out the platform, the business type, the locations and what they
          sell, then shows you before saving anything.
        </p>
        <code className="mt-3 block rounded bg-zinc-900 px-3 py-2 text-xs text-zinc-100">
          npx tsx src/scripts/add-client.ts https://example.com
        </code>
      </section>
    </div>
  )
}
