import { getCompetitors } from '@/lib/queries'
import { NoClient } from '../_components/no-client'
import { NeedsRun } from '../_components/ui'
import { activeClient } from '@/lib/active-client'

export const dynamic = 'force-dynamic'

function GapRow({
  label,
  mine,
  theirs,
  worse,
  note,
}: {
  label: string
  mine: string | number
  theirs: string | number
  worse: boolean
  note?: string
}) {
  return (
    <tr className={worse ? 'bg-rose-soft' : undefined}>
      <td className="px-4 py-3">
        <div className="font-medium">{label}</div>
        {note && <div className="text-xs text-ink-3">{note}</div>}
      </td>
      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${worse ? 'text-rose' : 'text-ink'}`}>
        {mine}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-ink-2">{theirs}</td>
    </tr>
  )
}

export default async function CompetitorsPage() {
  const active = await activeClient()
  if (!active) return <NoClient />
  const { rows, locals, nationals, client, localAvg } = getCompetitors(active)

  const cityLeaders = locals
    .filter((c) => c.cityPageCount > 0)
    .sort((a, b) => b.cityPageCount - a.cityPageCount)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="display text-3xl">Competitors</h1>
        <p className="mt-1 text-sm text-ink-3">
          Built by crawling the exact pages the AI engines cited. This is what winning looks like,
          measured rather than guessed.
        </p>
      </div>

      {rows.length === 0 ? (
        <NeedsRun
          what="No competitors profiled yet"
          step="Competitors are found from the domains the engines cited, so the engines have to be asked first."
        />
      ) : (
        <>
          {cityLeaders.length > 0 && (
            <section className="rounded-lg border border-rose/25 bg-rose-soft p-5">
              <h2 className="text-sm font-semibold text-rose">
                {cityLeaders.length} of {locals.length} competitors AI recommends are built on location pages
              </h2>
              <table className="mt-3 w-full text-sm">
                <tbody className="divide-y divide-rose/20">
                  {cityLeaders.map((c) => {
                    const pct = c.pageCount ? Math.round((c.cityPageCount / c.pageCount) * 100) : 0
                    return (
                      <tr key={c.id}>
                        <td className="py-2 font-medium">{c.domain}</td>
                        <td className="py-2 text-right tabular-nums text-rose">
                          {c.cityPageCount} of {c.pageCount} pages
                        </td>
                        <td className="w-40 py-2 pl-4">
                          <div className="h-2 w-full rounded-full bg-rose-soft">
                            <div className="h-2 rounded-full bg-rose" style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                        <td className="w-14 py-2 text-right tabular-nums text-xs text-rose">{pct}%</td>
                      </tr>
                    )
                  })}
                  <tr className="font-semibold">
                    <td className="py-2">{client.domain}</td>
                    <td className="py-2 text-right tabular-nums">0 of {client.pageCount} pages</td>
                    <td className="w-40 py-2 pl-4">
                      <div className="h-2 w-full rounded-full bg-rose-soft" />
                    </td>
                    <td className="w-14 py-2 text-right tabular-nums text-xs">0%</td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          <section className="overflow-hidden card">
            <div className="border-b border-line px-4 py-3">
              <h2 className="eyebrow">
                The gap — vs {localAvg.total} local rivals
              </h2>
              <p className="mt-0.5 text-xs text-ink-3">
                National chains excluded; averaging them in produces a target no local business could hit.
              </p>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-4 py-2 text-left">Metric</th>
                  <th className="px-4 py-2 text-right">Client</th>
                  <th className="px-4 py-2 text-right">Local rivals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <GapRow label="Total pages" mine={client.pageCount} theirs={localAvg.pageCount} worse={false} />
                <GapRow
                  label="Local city pages"
                  note="the strongest signal in this dataset"
                  mine={client.cityPageCount}
                  theirs={localAvg.cityPageCount}
                  worse={client.cityPageCount < localAvg.cityPageCount}
                />
                <GapRow
                  label="FAQ blocks"
                  note="the format AI quotes most"
                  mine={client.faqBlockCount}
                  theirs={localAvg.faqBlockCount}
                  worse={client.faqBlockCount < localAvg.faqBlockCount}
                />
                <GapRow
                  label="Statistics per 1,000 words"
                  note="the biggest measured lever in the GEO research"
                  mine={client.statsPerThousand}
                  theirs={localAvg.statsPerThousand}
                  worse={client.statsPerThousand < localAvg.statsPerThousand}
                />
                <GapRow
                  label="LocalBusiness schema"
                  mine={client.hasLocalBusiness ? 'yes' : 'NO'}
                  theirs={`${localAvg.withLocalBusiness}/${localAvg.total} have it`}
                  worse={!client.hasLocalBusiness}
                />
                <GapRow
                  label="Reading ease"
                  note="higher is easier; aim for 60+"
                  mine={client.avgReadability}
                  theirs={localAvg.avgReadability}
                  worse={client.avgReadability < localAvg.avgReadability}
                />
                <GapRow
                  label="Superlatives"
                  note="measured neutral-to-negative; lower is better"
                  mine={client.superlativeCount}
                  theirs={localAvg.superlativeCount}
                  worse={client.superlativeCount > localAvg.superlativeCount}
                />
              </tbody>
            </table>
          </section>

          <section className="space-y-3">
            <h2 className="display text-xl">Every domain AI cited</h2>
            {rows.map((c) => (
              <details key={c.id} className="card">
                <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-5 py-3 text-sm hover:bg-sink">
                  <span className="font-medium">{c.domain}</span>
                  {c.isNational && (
                    <span className="rounded bg-sink px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-3">
                      national chain
                    </span>
                  )}
                  <span className="text-ink-3">
                    cited {c.citationCount}x
                    {c.mentionCount > 0 && ` · named ${c.mentionCount}x`}
                  </span>
                  <span className="ml-auto text-ink-3">
                    {c.ok ? `${c.pageCount} pages · ${c.cityPageCount} city · ${c.faqBlockCount} FAQs` : `failed: ${c.error}`}
                  </span>
                </summary>
                <div className="grid gap-4 border-t border-line px-5 py-4 text-sm sm:grid-cols-2">
                  <div>
                    <div className="eyebrow">Schema found</div>
                    <p className="mt-1 text-ink-2">
                      {c.schemaList.length > 0 ? c.schemaList.join(', ') : <em className="text-ink-3">none</em>}
                    </p>
                    <div className="mt-3 text-[10px] font-bold uppercase tracking-wide text-ink-3">Phones</div>
                    <p className="mt-1 text-ink-2">
                      {c.phoneList.length > 0 ? c.phoneList.join(' · ') : <em className="text-ink-3">none found</em>}
                    </p>
                    <div className="mt-3 text-[10px] font-bold uppercase tracking-wide text-ink-3">Content</div>
                    <p className="mt-1 text-ink-2">
                      {c.statsPerThousand} stats/1k words · reading ease {c.avgReadability} ·{' '}
                      {c.superlativeCount} superlatives
                    </p>
                  </div>
                  <div>
                    <div className="eyebrow">
                      City pages ({c.cityPagesList.length} shown)
                    </div>
                    <ul className="mt-1 max-h-56 space-y-0.5 overflow-auto text-xs text-ink-2">
                      {c.cityPagesList.length === 0 && <li className="text-ink-3">none</li>}
                      {c.cityPagesList.map((u) => (
                        <li key={u} className="truncate">
                          <a href={u} target="_blank" rel="noreferrer" className="hover:underline">
                            {u.replace(/^https?:\/\/[^/]+/, '')}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </details>
            ))}
            {nationals.length > 0 && (
              <p className="text-xs text-ink-3">
                National chains excluded from the averages:{' '}
                {nationals.map((n) => `${n.domain} (${n.pageCount.toLocaleString()} pages)`).join(', ')}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
