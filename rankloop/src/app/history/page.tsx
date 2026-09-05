import Link from 'next/link'
import { activeClient } from '@/lib/active-client'
import { listChangeLog, listHistory, type HistoryEntry } from '@/lib/history'
import { STEP_BY_KEY } from '@/lib/pipeline'
import { NoClient } from '../_components/no-client'
import { PageHeader, Pill, StatusTag, Empty, NeedsRun, duration } from '../_components/ui'
import { AutoRefresh } from '../_components/auto-refresh'
import { deleteRunAction, rerunAction } from '../_actions/runs'

export const dynamic = 'force-dynamic'

/**
 * What every run measured, kept.
 *
 * The rest of the console is about the present — re-read a site and the page
 * count changes, publish a fix and a finding disappears. This page is the only
 * one that remembers, and it exists to answer the single question a client
 * actually asks after a few months: is any of this working.
 *
 * Which is why every row carries its movement against the run before it. One
 * number on its own says nothing.
 */
export default async function HistoryPage() {
  const client = await activeClient()
  if (!client) return <NoClient />

  const entries = listHistory(client.id)
  const changes = listChangeLog(client.id)
  const live = entries.some((e) => e.status === 'running' || e.status === 'queued')
  const measured = entries.filter((e) => e.result && e.result.answersTotal > 0).reverse()

  return (
    <div className="space-y-8">
      <AutoRefresh active={live} />

      <PageHeader
        title="History"
        subtitle={`Every run for ${client.name}, with the numbers as they stood when it finished. Nothing here is recalculated later.`}
        actions={
          <Link href="/clients" className="btn btn-primary">
            Start a new run
          </Link>
        }
      />

      {entries.length === 0 ? (
        <NeedsRun
          what="No runs recorded yet"
          step="History fills itself in — every run writes one row here when it finishes."
        />
      ) : (
        <>
          {measured.length > 1 && <Trend entries={measured} />}

          <section className="card overflow-hidden">
            <header className="border-b border-line px-5 py-4">
              <h2 className="display text-lg">Runs</h2>
              <p className="mt-0.5 text-sm text-ink-3">
                Newest first. The arrow on each figure is the change from the previous run that
                measured anything.
              </p>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[76rem] text-sm">
                <thead className="bg-sink text-left">
                  <tr className="text-xs uppercase tracking-wide text-ink-3">
                    <th className="px-4 py-3 font-semibold">Run</th>
                    <th className="px-4 py-3 font-semibold">Finished</th>
                    <th className="px-4 py-3 font-semibold">What ran</th>
                    <th className="px-4 py-3 font-semibold">Named in AI</th>
                    <th className="px-4 py-3 font-semibold">Critical</th>
                    <th className="px-4 py-3 font-semibold">Fix list</th>
                    <th className="px-4 py-3 font-semibold">Published</th>
                    <th className="px-4 py-3 font-semibold">Pages</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Report</th>
                    <th className="sticky right-0 bg-sink px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {entries.map((e) => (
                    <Row key={e.runId} entry={e} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {entries[0]?.result && <Breakdown entry={entries[0]} />}
        </>
      )}

      <section className="card overflow-hidden">
        <header className="border-b border-line px-5 py-4">
          <h2 className="display text-lg">Changes published to the site</h2>
          <p className="mt-0.5 text-sm text-ink-3">
            Every edit this tool wrote to {client.domain}, with what was there before it.
          </p>
        </header>
        <div className="p-5">
          {changes.length === 0 ? (
            <Empty title="Nothing has been published yet">
              Connect the website on the Apply fixes screen and approved changes are written
              straight to it — each one recorded here.
              <div className="mt-4">
                <Link href="/fixes" className="btn btn-primary">
                  Apply fixes
                </Link>
              </div>
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {changes.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start gap-3 py-3">
                  <StatusTag status={c.status} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {FIELD_LABEL[c.field] ?? c.field}
                      <span className="ml-2 font-normal text-ink-3">
                        {c.appliedAt?.toLocaleString() ?? ''}
                      </span>
                    </p>
                    <a
                      href={c.targetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-xs text-ink-3 hover:text-pine hover:underline"
                    >
                      {c.targetUrl}
                    </a>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-2">{c.appliedValue}</p>
                    {c.error && <p className="mt-1 text-sm text-rose">{c.error}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

const FIELD_LABEL: Record<string, string> = {
  meta_title: 'Page title',
  meta_description: 'Search description',
  copy: 'Body copy',
}

function Row({ entry: e }: { entry: HistoryEntry }) {
  const r = e.result
  return (
    <tr className="align-top transition hover:bg-sink/60">
      <td className="px-4 py-3">
        <Link href={`/runs/${e.runId}`} className="font-semibold text-pine-deep">
          #{e.runId}
        </Link>
        {e.label && <div className="text-xs text-ink-3">{e.label}</div>}
      </td>

      <td className="whitespace-nowrap px-4 py-3 text-ink-2">
        {e.finishedAt ? (
          <>
            <div>{e.finishedAt.toLocaleDateString()}</div>
            <div className="text-xs text-ink-3">
              {e.finishedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ·{' '}
              {duration(e.startedAt, e.finishedAt)}
            </div>
          </>
        ) : (
          <span className="text-ink-3">in progress</span>
        )}
      </td>

      <td className="px-4 py-3">
        <div className="flex max-w-[13rem] flex-wrap gap-1">
          {e.stepKeys.map((k) => (
            <Pill key={k} tone="neutral">
              {STEP_BY_KEY.get(k)?.label ?? k}
            </Pill>
          ))}
        </div>
        <div className="mt-1 text-xs text-ink-3">
          {e.stepsDone} of {e.stepsTotal} finished
        </div>
      </td>

      <Figure
        value={r ? `${r.namedPct}%` : '—'}
        detail={r ? `${r.answersNamed} of ${r.answersTotal}` : 'not recorded'}
        delta={e.change?.namedPct}
        betterWhen="up"
        suffix="pt"
      />
      <Figure
        value={r?.findingsCritical ?? '—'}
        detail={r ? `${r.findingsTotal} in total` : ''}
        delta={e.change?.findingsCritical}
        betterWhen="down"
      />
      <Figure
        value={r?.recommendationsTotal ?? '—'}
        detail={r ? `${r.recommendationsBlocked} need a fact` : ''}
        delta={e.change?.recommendationsTotal}
        betterWhen="none"
      />
      <Figure
        value={r?.fixesPublished ?? '—'}
        detail=""
        delta={e.change?.fixesPublished}
        betterWhen="up"
      />
      <Figure
        value={r?.pagesRead ?? '—'}
        detail={r && r.wrongGeoPages > 0 ? `${r.wrongGeoPages} wrong area` : ''}
        delta={e.change?.pagesRead}
        betterWhen="none"
      />

      <td className="px-4 py-3">
        <StatusTag status={e.status} />
        {e.error && <div className="mt-1 max-w-[14rem] text-xs text-rose">{e.error}</div>}
      </td>

      <td className="px-4 py-3">
        {r?.hasReport ? (
          <a
            href={`/api/report?run=${e.runId}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-pine underline"
          >
            Open
          </a>
        ) : (
          <span className="text-xs text-ink-3">none</span>
        )}
      </td>

      <td className="sticky right-0 bg-card px-4 py-3 shadow-[-8px_0_12px_-8px_rgba(29,36,34,0.18)]">
        <div className="flex gap-1 whitespace-nowrap">
          <form action={rerunAction}>
            <input type="hidden" name="runId" value={e.runId} />
            <button type="submit" className="btn btn-secondary btn-sm">
              Re-run
            </button>
          </form>
          <form action={deleteRunAction}>
            <input type="hidden" name="runId" value={e.runId} />
            <button type="submit" className="btn btn-danger btn-sm">
              Delete
            </button>
          </form>
        </div>
      </td>
    </tr>
  )
}

/**
 * One measured figure with its movement.
 *
 * `betterWhen` decides the colour, because up is not always good: more critical
 * findings is worse, and a longer fix list is neither — it usually just means
 * more of the site was read.
 */
function Figure({
  value,
  detail,
  delta,
  betterWhen,
  suffix = '',
}: {
  value: string | number
  detail: string
  delta?: number
  betterWhen: 'up' | 'down' | 'none'
  suffix?: string
}) {
  const moved = delta !== undefined && delta !== 0
  const good =
    betterWhen === 'none' || !moved ? null : betterWhen === 'up' ? delta > 0 : delta < 0
  const colour = good === null ? 'text-ink-3' : good ? 'text-moss-deep' : 'text-rose'

  return (
    <td className="whitespace-nowrap px-4 py-3">
      <div className="display text-lg tabular-nums">{value}</div>
      {moved && (
        <div className={`text-xs font-semibold tabular-nums ${colour}`}>
          {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
          {suffix}
        </div>
      )}
      {detail && <div className="text-xs text-ink-3">{detail}</div>}
    </td>
  )
}

/** How often the engines named the business, run by run. */
function Trend({ entries }: { entries: HistoryEntry[] }) {
  const peak = Math.max(10, ...entries.map((e) => e.result?.namedPct ?? 0))
  return (
    <section className="card p-5">
      <h2 className="display text-lg">Named in AI answers, over time</h2>
      <p className="mt-0.5 text-sm text-ink-3">
        Oldest on the left. Only runs that actually asked the engines appear here.
      </p>
      <div className="mt-5 flex items-end gap-3 overflow-x-auto pb-2">
        {entries.map((e) => {
          const pct = e.result?.namedPct ?? 0
          return (
            <div key={e.runId} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
              <span className="text-xs font-semibold tabular-nums text-ink-2">{pct}%</span>
              <div className="flex h-24 w-full items-end rounded-t bg-sink">
                <div
                  className={`w-full rounded-t ${pct === 0 ? 'bg-rose' : 'bg-pine'}`}
                  style={{ height: `${Math.max(3, (pct / peak) * 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-ink-3">#{e.runId}</span>
              <span className="text-[10px] text-ink-3">
                {e.finishedAt?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** The latest run, broken out the way the engines and markets actually differ. */
function Breakdown({ entry }: { entry: HistoryEntry }) {
  const r = entry.result
  if (!r) return null
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <section className="card p-5">
        <h3 className="eyebrow">Run #{entry.runId} · by engine</h3>
        {r.byEngine.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">This run did not ask the engines.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-line">
              {r.byEngine.map((e) => (
                <tr key={e.engine}>
                  <td className="py-2 font-medium">{e.engine}</td>
                  <td className="py-2 text-right tabular-nums text-ink-3">
                    {e.failed > 0 && `${e.failed} failed · `}
                  </td>
                  <td
                    className={`py-2 text-right tabular-nums ${
                      e.named === 0 ? 'text-rose' : 'text-moss-deep'
                    }`}
                  >
                    {e.named}/{e.answers}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card p-5">
        <h3 className="eyebrow">Run #{entry.runId} · by market</h3>
        {r.byMarket.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">No markets recorded for this run.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-line">
              {r.byMarket.map((m) => (
                <tr key={m.label}>
                  <td className="py-2 font-medium">{m.label}</td>
                  <td
                    className={`py-2 text-right tabular-nums ${
                      m.answers === 0 ? 'text-ink-3' : m.named === 0 ? 'text-rose' : 'text-moss-deep'
                    }`}
                  >
                    {m.answers === 0 ? 'not measured' : `${m.named}/${m.answers}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card p-5">
        <h3 className="eyebrow">Run #{entry.runId} · recommended instead</h3>
        {r.topCompetitors.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">No businesses were named in this run.</p>
        ) : (
          <ol className="mt-3 space-y-1.5 text-sm">
            {r.topCompetitors.map((c) => (
              <li key={c.name} className="flex justify-between gap-4">
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 tabular-nums text-ink-3">{c.count}x</span>
              </li>
            ))}
          </ol>
        )}
        {r.gbpRating !== null && (
          <p className="mt-4 border-t border-line pt-3 text-sm text-ink-2">
            Google listing at the time: {r.gbpRating}★ ·{' '}
            {r.gbpReviewCount ?? 'unknown'} reviews
          </p>
        )}
      </section>
    </div>
  )
}
