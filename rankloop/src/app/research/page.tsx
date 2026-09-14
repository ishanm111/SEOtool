import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { activeClient } from '@/lib/active-client'
import { NoClient } from '../_components/no-client'
import { NeedsRun, PageHeader, Pill, Section, Stat, timeAgo } from '../_components/ui'

export const dynamic = 'force-dynamic'

const parse = <T,>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const SEVERITY_TONE = { critical: 'bad', high: 'warn', medium: 'info', low: 'neutral' } as const

/**
 * What Google shows this client's customers, read through a real browser from
 * inside the client's own towns.
 *
 * Decisions first: the findings the research produced lead the page, and the
 * raw searches sit underneath as the evidence for them. An operator opens this
 * to learn what to change, not to read a results page twice.
 */
export default async function ResearchPage() {
  const client = await activeClient()
  if (!client) return <NoClient />

  const snapshots = db
    .select()
    .from(schema.serpSnapshots)
    .where(eq(schema.serpSnapshots.clientId, client.id))
    .all()
  const profiles = db
    .select()
    .from(schema.businessProfiles)
    .where(eq(schema.businessProfiles.clientId, client.id))
    .all()
  const findings = db
    .select()
    .from(schema.findings)
    .where(eq(schema.findings.clientId, client.id))
    .all()
    .filter((f) => f.category.startsWith('google-'))
    .sort(
      (a, b) =>
        ['critical', 'high', 'medium', 'low'].indexOf(a.severity) -
        ['critical', 'high', 'medium', 'low'].indexOf(b.severity),
    )

  if (snapshots.length === 0) {
    return (
      <div>
        <PageHeader
          title="Google research"
          subtitle="Searches Google the way this business's customers do — from inside its own towns — and reads the AI Overview, map pack, top 10, People also ask, search suggestions and ads."
        />
        <NeedsRun
          what="No Google research yet"
          step="Tick “Research Google” when starting a run, or run npm run research from the command line."
        />
      </div>
    )
  }

  const ok = snapshots.filter((s) => s.ok)
  const topic = ok.filter((s) => s.queryKind === 'service' || s.queryKind === 'question')
  const withAio = topic.filter((s) => s.aiOverviewText)
  const withPack = ok.filter((s) => parse<unknown[]>(s.localPack, []).length > 0)
  const capturedAt = snapshots.reduce<Date | null>(
    (latest, s) => (s.capturedAt && (!latest || s.capturedAt > latest) ? s.capturedAt : latest),
    null,
  )

  return (
    <div className="space-y-8">
      <PageHeader
        title="Google research"
        subtitle={
          <>
            {ok.length} of {snapshots.length} searches captured {timeAgo(capturedAt)}, each pinned to the
            client&apos;s own town. Findings feed the fix list; People also ask and search suggestions feed
            the blog posts.
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="AI Overview names them"
          value={`${withAio.filter((s) => s.clientInAiOverview).length}/${withAio.length}`}
          hint={`shown on ${withAio.length} of ${topic.length} customer searches`}
          tone={withAio.some((s) => s.clientInAiOverview) ? 'good' : 'bad'}
        />
        <Stat
          label="AI Overview links the site"
          value={`${withAio.filter((s) => s.clientCitedInAiOverview).length}/${withAio.length}`}
          tone={withAio.some((s) => s.clientCitedInAiOverview) ? 'good' : 'bad'}
        />
        <Stat
          label="In the map pack"
          value={`${withPack.filter((s) => s.clientPackPosition !== null).length}/${withPack.length}`}
          hint="searches that showed one"
          tone={withPack.some((s) => s.clientPackPosition !== null) ? 'good' : 'bad'}
        />
        <Stat
          label="In the top 10"
          value={`${topic.filter((s) => s.clientOrganicPosition !== null).length}/${topic.length}`}
          hint="customer searches, brand excluded"
          tone={topic.some((s) => s.clientOrganicPosition !== null) ? 'good' : 'bad'}
        />
      </div>

      <Section
        title="What to change"
        description="Built from these searches by the analysis step. Re-run “Work out what is wrong” after new research."
      >
        {findings.length === 0 ? (
          <p className="text-sm text-ink-3">
            No research findings yet — run the analysis step to turn these searches into changes.
          </p>
        ) : (
          <ul className="space-y-4">
            {findings.map((f) => (
              <li key={f.id} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={SEVERITY_TONE[f.severity as keyof typeof SEVERITY_TONE] ?? 'neutral'}>
                    {f.severity}
                  </Pill>
                  <span className="text-xs text-ink-3">{f.category.replace(/^google-/, '').replace(/-/g, ' ')}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-ink">{f.issue}</p>
                {f.proposedText && <p className="mt-1.5 text-sm text-ink-2">{f.proposedText}</p>}
                {f.evidence && <p className="mt-1.5 text-xs text-ink-3">{f.evidence}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {profiles.length > 0 && (
        <Section
          title="Google listings"
          description="Read from Maps with reviews sorted newest first. Pace is what a website change cannot catch up with."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="py-2 pr-4">Business</th>
                  <th className="py-2 pr-4 text-right">Rating</th>
                  <th className="py-2 pr-4 text-right">Reviews</th>
                  <th className="py-2 pr-4 text-right">Last 30 days</th>
                  <th className="py-2 pr-4 text-right">Newest</th>
                  <th className="py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {profiles.map((p) => (
                  <tr key={p.id} className={p.isClient ? 'bg-pine-soft/50 font-semibold' : undefined}>
                    <td className="py-2 pr-4">
                      {p.businessName}
                      {p.isClient && <span className="ml-2 text-xs text-pine-deep">client</span>}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{p.rating ?? '—'}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{p.reviewCount ?? '—'}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{p.reviewsLast30Days ?? '—'}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {p.newestReviewDays === null ? '—' : p.newestReviewDays === 0 ? 'today' : `${p.newestReviewDays}d`}
                    </td>
                    <td className="py-2 text-xs text-ink-3">
                      {!p.ok ? p.error : p.unclaimed ? <Pill tone="bad">unclaimed</Pill> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Every search" description="Open one for its AI Overview sources, People also ask, suggestions and screenshot.">
        <ul className="divide-y divide-line">
          {snapshots.map((s) => {
            const sources = parse<{ domain: string; url: string; title: string }[]>(s.aiOverviewSources, [])
            const pack = parse<{ title: string; rating: number | null; ratingCount: number | null }[]>(s.localPack, [])
            const organic = parse<{ domain: string; position: number }[]>(s.organic, [])
            const paa = parse<string[]>(s.peopleAlsoAsk, [])
            const suggestions = parse<string[]>(s.suggestions, [])
            const related = parse<string[]>(s.relatedSearches, [])
            return (
              <li key={s.id} className="py-3">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <Pill tone="neutral">{s.queryKind}</Pill>
                    <span className="font-medium text-ink">{s.query}</span>
                    {!s.ok ? (
                      <Pill tone="bad">failed</Pill>
                    ) : (
                      <>
                        <Pill tone={s.clientInAiOverview ? 'good' : s.aiOverviewText ? 'bad' : 'neutral'}>
                          {s.aiOverviewText ? (s.clientInAiOverview ? 'AIO names client' : 'AIO, not named') : 'no AIO'}
                        </Pill>
                        {pack.length > 0 && (
                          <Pill tone={s.clientPackPosition ? 'good' : 'bad'}>
                            {s.clientPackPosition ? `map #${s.clientPackPosition}` : 'not in map pack'}
                          </Pill>
                        )}
                        <Pill tone={s.clientOrganicPosition ? 'good' : 'warn'}>
                          {s.clientOrganicPosition ? `organic #${s.clientOrganicPosition}` : 'not in top 10'}
                        </Pill>
                        {s.adsCount > 0 && <Pill tone="info">{s.adsCount} ads</Pill>}
                      </>
                    )}
                  </summary>

                  <div className="mt-3 grid gap-4 text-sm lg:grid-cols-2">
                    {!s.ok && <p className="text-rose">{s.error}</p>}
                    {s.aiOverviewText && (
                      <div className="lg:col-span-2">
                        <div className="eyebrow">AI Overview</div>
                        <p className="mt-1 whitespace-pre-line text-ink-2">{s.aiOverviewText.slice(0, 1200)}</p>
                        {sources.length > 0 && (
                          <ul className="mt-2 space-y-0.5 text-xs">
                            {sources.map((src) => (
                              <li key={src.url} className="truncate text-ink-3">
                                <span className="font-medium text-ink-2">{src.domain}</span> — {src.title}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    {pack.length > 0 && (
                      <div>
                        <div className="eyebrow">Map pack</div>
                        <ol className="mt-1 list-decimal pl-5 text-ink-2">
                          {pack.map((e) => (
                            <li key={e.title}>
                              {e.title} — {e.rating ?? '?'}★ ({e.ratingCount ?? '?'})
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {organic.length > 0 && (
                      <div>
                        <div className="eyebrow">Top 10</div>
                        <ol className="mt-1 list-decimal pl-5 text-ink-2">
                          {organic.map((o) => (
                            <li key={`${o.position}-${o.domain}`}>{o.domain}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {paa.length > 0 && (
                      <div>
                        <div className="eyebrow">People also ask</div>
                        <ul className="mt-1 list-disc pl-5 text-ink-2">
                          {paa.map((q) => (
                            <li key={q}>{q}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(suggestions.length > 0 || related.length > 0) && (
                      <div>
                        <div className="eyebrow">What people type</div>
                        <p className="mt-1 text-ink-2">{[...suggestions, ...related].join(' · ')}</p>
                      </div>
                    )}
                    {s.screenshotPath && (
                      <a
                        className="text-xs text-pine-deep underline lg:col-span-2"
                        href={`/api/screenshot?path=${encodeURIComponent(s.screenshotPath)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Screenshot of the results page
                      </a>
                    )}
                  </div>
                </details>
              </li>
            )
          })}
        </ul>
      </Section>
    </div>
  )
}
