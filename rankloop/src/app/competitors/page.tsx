import { getCompetitors } from '@/lib/queries'
import { NoClient } from '../_components/no-client'
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
    <tr className={worse ? 'bg-red-50' : undefined}>
      <td className="px-4 py-3">
        <div className="font-medium">{label}</div>
        {note && <div className="text-xs text-zinc-500">{note}</div>}
      </td>
      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${worse ? 'text-red-600' : 'text-zinc-900'}`}>
        {mine}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-zinc-600">{theirs}</td>
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
        <h1 className="text-2xl font-semibold tracking-tight">Competitors</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Built by crawling the exact pages the AI engines cited. This is what winning looks like,
          measured rather than guessed.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          Nothing mined yet. Run{' '}
          <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">
            npx tsx src/scripts/mine-competitors.ts
          </code>
        </div>
      ) : (
        <>
          {cityLeaders.length > 0 && (
            <section className="rounded-lg border border-red-200 bg-red-50 p-5">
              <h2 className="text-sm font-semibold text-red-800">
                {cityLeaders.length} of {locals.length} competitors AI recommends are built on location pages
              </h2>
              <table className="mt-3 w-full text-sm">
                <tbody className="divide-y divide-red-100">
                  {cityLeaders.map((c) => {
                    const pct = c.pageCount ? Math.round((c.cityPageCount / c.pageCount) * 100) : 0
                    return (
                      <tr key={c.id}>
                        <td className="py-2 font-medium">{c.domain}</td>
                        <td className="py-2 text-right tabular-nums text-red-800">
                          {c.cityPageCount} of {c.pageCount} pages
                        </td>
                        <td className="w-40 py-2 pl-4">
                          <div className="h-2 w-full rounded-full bg-red-100">
                            <div className="h-2 rounded-full bg-red-500" style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                        <td className="w-14 py-2 text-right tabular-nums text-xs text-red-700">{pct}%</td>
                      </tr>
                    )
                  })}
                  <tr className="font-semibold">
                    <td className="py-2">{client.domain}</td>
                    <td className="py-2 text-right tabular-nums">0 of {client.pageCount} pages</td>
                    <td className="w-40 py-2 pl-4">
                      <div className="h-2 w-full rounded-full bg-red-100" />
                    </td>
                    <td className="w-14 py-2 text-right tabular-nums text-xs">0%</td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                The gap — vs {localAvg.total} local rivals
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                National chains excluded; averaging them in produces a target no local business could hit.
              </p>
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2 text-left">Metric</th>
                  <th className="px-4 py-2 text-right">Client</th>
                  <th className="px-4 py-2 text-right">Local rivals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
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
            <h2 className="text-lg font-semibold tracking-tight">Every domain AI cited</h2>
            {rows.map((c) => (
              <details key={c.id} className="rounded-lg border border-zinc-200 bg-white">
                <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-5 py-3 text-sm hover:bg-zinc-50">
                  <span className="font-medium">{c.domain}</span>
                  {c.isNational && (
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                      national chain
                    </span>
                  )}
                  <span className="text-zinc-500">
                    cited {c.citationCount}x
                    {c.mentionCount > 0 && ` · named ${c.mentionCount}x`}
                  </span>
                  <span className="ml-auto text-zinc-500">
                    {c.ok ? `${c.pageCount} pages · ${c.cityPageCount} city · ${c.faqBlockCount} FAQs` : `failed: ${c.error}`}
                  </span>
                </summary>
                <div className="grid gap-4 border-t border-zinc-100 px-5 py-4 text-sm sm:grid-cols-2">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Schema found</div>
                    <p className="mt-1 text-zinc-700">
                      {c.schemaList.length > 0 ? c.schemaList.join(', ') : <em className="text-zinc-400">none</em>}
                    </p>
                    <div className="mt-3 text-[10px] font-bold uppercase tracking-wide text-zinc-500">Phones</div>
                    <p className="mt-1 text-zinc-700">
                      {c.phoneList.length > 0 ? c.phoneList.join(' · ') : <em className="text-zinc-400">none found</em>}
                    </p>
                    <div className="mt-3 text-[10px] font-bold uppercase tracking-wide text-zinc-500">Content</div>
                    <p className="mt-1 text-zinc-700">
                      {c.statsPerThousand} stats/1k words · reading ease {c.avgReadability} ·{' '}
                      {c.superlativeCount} superlatives
                    </p>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                      City pages ({c.cityPagesList.length} shown)
                    </div>
                    <ul className="mt-1 max-h-56 space-y-0.5 overflow-auto text-xs text-zinc-600">
                      {c.cityPagesList.length === 0 && <li className="text-zinc-400">none</li>}
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
              <p className="text-xs text-zinc-500">
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
