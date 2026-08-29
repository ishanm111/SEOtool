import Link from 'next/link'
import { getOverview } from '@/lib/queries'
import { NoClient } from './_components/no-client'
import { activeClient } from '@/lib/active-client'

export const dynamic = 'force-dynamic'

function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'bad' | 'good'
}) {
  const toneClass =
    tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-600' : 'text-zinc-900'
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-sm text-zinc-500">{hint}</div>}
    </div>
  )
}

export default async function Home() {
  const client = await activeClient()
  if (!client) return <NoClient />
  const o = getOverview(client)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
        <p className="text-sm text-zinc-500">{client.domain}</p>
      </div>

      {o.wrongGeoPages > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-5">
          <div className="text-sm font-semibold text-red-800">
            The website targets the wrong places
          </div>
          <p className="mt-1 text-sm text-red-700">
            {o.wrongGeoPages} of {o.pageCount} pages reference places outside the service area (
            {o.wrongGeoHits} references in total). No amount of copy tuning works until this is
            fixed.
          </p>
          <Link
            href="/findings"
            className="mt-3 inline-block text-sm font-medium text-red-800 underline"
          >
            See the full fix list
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Named in AI answers"
          value={o.totalAnswers ? `${o.named}/${o.totalAnswers}` : '—'}
          hint={o.totalAnswers ? `${o.pct}% of answers` : 'no measurement run yet'}
          tone={
            o.totalAnswers === 0 ? 'default' : o.pct === 0 ? 'bad' : o.pct > 30 ? 'good' : 'default'
          }
        />
        <Stat
          label="Critical findings"
          value={o.criticalCount}
          hint={`${o.findingCount} findings total`}
          tone={o.criticalCount > 0 ? 'bad' : 'good'}
        />
        <Stat label="Pages analysed" value={o.pageCount} hint={`${o.paragraphCount} paragraphs`} />
        <Stat
          label="Questions tracked"
          value={o.promptCount}
          hint={o.locationCount > 0 ? `across ${o.locationCount} locations` : 'no locations set'}
        />
      </div>

      {o.markets.length > 1 && (
        <section className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">By market</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Each area is a separate contest. A combined figure would hide the weaker one.
          </p>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="pb-2">Market</th>
                <th className="pb-2">Places</th>
                <th className="pb-2">Named in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {o.markets.map((m) => (
                <tr key={m.label}>
                  <td className="py-2 font-medium">{m.label}</td>
                  <td className="py-2 text-zinc-500">{m.places.join(', ')}</td>
                  <td
                    className={`py-2 tabular-nums ${
                      m.total === 0 ? 'text-zinc-500' : m.named === 0 ? 'text-red-600' : 'text-emerald-600'
                    }`}
                  >
                    {m.total === 0 ? 'not measured' : `${m.named}/${m.total}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">By engine</h2>
        {o.engines.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Nothing measured yet. Run{' '}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">
              npx tsx src/scripts/measure.ts
            </code>
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="pb-2">Engine</th>
                <th className="pb-2">Answers</th>
                <th className="pb-2">Failed</th>
                <th className="pb-2">Client named</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {o.engines.map((e) => (
                <tr key={e.engine}>
                  <td className="py-2 font-medium">{e.engine}</td>
                  <td className="py-2 tabular-nums">{e.ok}</td>
                  <td className="py-2 tabular-nums text-zinc-500">{e.failed}</td>
                  <td
                    className={`py-2 tabular-nums ${e.named === 0 ? 'text-red-600' : 'text-emerald-600'}`}
                  >
                    {e.named}/{e.ok}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Who AI recommends instead
          </h2>
          {o.competitors.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No answers parsed yet.</p>
          ) : (
            <ol className="mt-3 space-y-1.5 text-sm">
              {o.competitors.map(([name, count]) => (
                <li key={name} className="flex justify-between gap-4">
                  <span className="truncate">{name}</span>
                  <span className="shrink-0 tabular-nums text-zinc-500">{count}x</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Sources AI cites
          </h2>
          {o.citedDomains.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No citations captured yet.</p>
          ) : (
            <ol className="mt-3 space-y-1.5 text-sm">
              {o.citedDomains.map(([domain, count]) => (
                <li key={domain} className="flex justify-between gap-4">
                  <span className="truncate">{domain}</span>
                  <span className="shrink-0 tabular-nums text-zinc-500">{count}x</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}
