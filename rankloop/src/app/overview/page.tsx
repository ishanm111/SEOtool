import Link from 'next/link'
import { getOverview } from '@/lib/queries'
import { NoClient } from '../_components/no-client'
import { activeClient } from '@/lib/active-client'
import { PageHeader, Stat } from '../_components/ui'
import { StartRun } from '../_components/start-run'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const client = await activeClient()
  if (!client) return <NoClient />
  const o = getOverview(client)

  return (
    <div className="space-y-8">
      <PageHeader
        title={client.name}
        subtitle={
          <a
            href={client.homepageUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-pine hover:underline"
          >
            {client.domain}
          </a>
        }
        actions={
          <>
            <Link href="/fixes" className="btn btn-secondary">
              Apply fixes
            </Link>
            <StartRun clientId={client.id} clientName={client.name} />
          </>
        }
      />

      {o.wrongGeoPages > 0 && (
        <div className="rounded-lg border border-rose/25 bg-rose-soft p-5">
          <div className="text-sm font-semibold text-rose">
            The website targets the wrong places
          </div>
          <p className="mt-1 text-sm text-rose">
            {o.wrongGeoPages} of {o.pageCount} pages reference places outside the service area (
            {o.wrongGeoHits} references in total). No amount of copy tuning works until this is
            fixed.
          </p>
          <Link
            href="/findings"
            className="mt-3 inline-block text-sm font-medium text-rose underline"
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
            o.totalAnswers === 0 ? 'neutral' : o.pct === 0 ? 'bad' : o.pct > 30 ? 'good' : 'warn'
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
        <section className="card p-5">
          <h2 className="eyebrow">By market</h2>
          <p className="mt-1 text-sm text-ink-3">
            Each area is a separate contest. A combined figure would hide the weaker one.
          </p>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-3">
              <tr>
                <th className="pb-2">Market</th>
                <th className="pb-2">Places</th>
                <th className="pb-2">Named in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {o.markets.map((m) => (
                <tr key={m.label}>
                  <td className="py-2 font-medium">{m.label}</td>
                  <td className="py-2 text-ink-3">{m.places.join(', ')}</td>
                  <td
                    className={`py-2 tabular-nums ${
                      m.total === 0 ? 'text-ink-3' : m.named === 0 ? 'text-rose' : 'text-pine'
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

      <section className="card p-5">
        <h2 className="eyebrow">By engine</h2>
        {o.engines.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">
            The engines have not been asked yet. A run does that.
          </p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-3">
              <tr>
                <th className="pb-2">Engine</th>
                <th className="pb-2">Answers</th>
                <th className="pb-2">Failed</th>
                <th className="pb-2">Client named</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {o.engines.map((e) => (
                <tr key={e.engine}>
                  <td className="py-2 font-medium">{e.engine}</td>
                  <td className="py-2 tabular-nums">{e.ok}</td>
                  <td className="py-2 tabular-nums text-ink-3">{e.failed}</td>
                  <td
                    className={`py-2 tabular-nums ${e.named === 0 ? 'text-rose' : 'text-pine'}`}
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
        <section className="card p-5">
          <h2 className="eyebrow">
            Who AI recommends instead
          </h2>
          {o.competitors.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">No answers parsed yet.</p>
          ) : (
            <ol className="mt-3 space-y-1.5 text-sm">
              {o.competitors.map(([name, count]) => (
                <li key={name} className="flex justify-between gap-4">
                  <span className="truncate">{name}</span>
                  <span className="shrink-0 tabular-nums text-ink-3">{count}x</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="card p-5">
          <h2 className="eyebrow">
            Sources AI cites
          </h2>
          {o.citedDomains.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">No citations captured yet.</p>
          ) : (
            <ol className="mt-3 space-y-1.5 text-sm">
              {o.citedDomains.map(([domain, count]) => (
                <li key={domain} className="flex justify-between gap-4">
                  <span className="truncate">{domain}</span>
                  <span className="shrink-0 tabular-nums text-ink-3">{count}x</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}
