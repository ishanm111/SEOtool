import Link from 'next/link'
import { getWorkspace, type Attention } from '@/lib/workspace'
import { STEP_BY_KEY } from '@/lib/pipeline'
import { PageHeader, Pill, StatusTag, Empty, timeAgo, duration } from './_components/ui'
import { ClientCard } from './_components/client-card'
import { SwitchToClient } from './_components/switch-to-client'
import { AutoRefresh } from './_components/auto-refresh'

export const dynamic = 'force-dynamic'

/**
 * The first screen: every client, and what to do next.
 *
 * Ordered by how a morning actually goes — what is broken, what is running,
 * then everyone. The portfolio totals sit at the top but stay deliberately
 * quiet: a combined "named in 6% of answers" across four businesses is not a
 * number anyone is paid to move, and reading it as one would hide the client
 * sitting at zero.
 */
export default function Home() {
  const { cards, totals, attention, activeRuns, runs, recentChanges } = getWorkspace()

  if (cards.length === 0) return <FirstRun />

  const topAttention = attention.slice(0, 6)

  return (
    <div className="space-y-8">
      <AutoRefresh active={activeRuns.length > 0} everyMs={5000} />

      <PageHeader
        title="Good to see you"
        subtitle={`${totals.clients} client${totals.clients === 1 ? '' : 's'} tracked${
          activeRuns.length > 0
            ? ` · ${activeRuns.length} run${activeRuns.length === 1 ? '' : 's'} going right now`
            : ''
        }`}
        actions={
          <>
            <Link href="/runs" className="btn btn-secondary">
              Runs
            </Link>
            <Link href="/clients/new" className="btn btn-primary">
              + Add a client
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Named in AI"
          value={totals.namedPct === null ? '—' : `${totals.namedPct}%`}
          hint={
            totals.answers === 0
              ? 'nothing measured yet'
              : `${totals.named} of ${totals.answers} answers, all clients`
          }
          tone={totals.namedPct === null ? 'neutral' : totals.namedPct === 0 ? 'bad' : 'good'}
        />
        <Tile
          label="Critical findings"
          value={totals.critical}
          hint={`${totals.findings} findings across the book`}
          tone={totals.critical > 0 ? 'bad' : 'good'}
        />
        <Tile
          label="Fixes written"
          value={totals.recommendations}
          hint={`${totals.published} published to a live site`}
          tone={totals.recommendations > 0 ? 'info' : 'neutral'}
        />
        <Tile
          label="Sites connected"
          value={`${totals.connected}/${totals.clients}`}
          hint={
            totals.connected === totals.clients
              ? 'every client can be published to'
              : 'the rest have to be edited by hand'
          }
          tone={totals.connected === totals.clients ? 'good' : 'warn'}
        />
      </div>

      {activeRuns.length > 0 && (
        <section className="card overflow-hidden">
          <header className="border-b border-line px-5 py-4">
            <h2 className="display text-lg">Happening now</h2>
          </header>
          <ul className="divide-y divide-line">
            {activeRuns.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <StatusTag status={r.status} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{r.clientName}</p>
                  <p className="text-xs text-ink-3">
                    {r.currentStep
                      ? STEP_BY_KEY.get(r.currentStep as never)?.label ?? r.currentStep
                      : 'starting'}{' '}
                    · step {r.stepsDone + 1} of {r.stepsTotal} · {duration(r.startedAt, null)}
                  </p>
                </div>
                <Link href={`/runs/${r.id}`} className="btn btn-secondary btn-sm">
                  Watch it
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {topAttention.length > 0 && (
        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="display text-xl">Needs a decision</h2>
              <p className="mt-0.5 text-sm text-ink-3">
                Worst first. Everything here links to the one screen that does something about it.
              </p>
            </div>
            {attention.length > topAttention.length && (
              <span className="text-sm text-ink-3">
                and {attention.length - topAttention.length} more
              </span>
            )}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {topAttention.map((a, i) => (
              <AttentionCard key={`${a.clientId}-${i}`} item={a} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="display text-xl">Clients</h2>
            <p className="mt-0.5 text-sm text-ink-3">
              Press “Start a new run” on any of them. A run that skips the engines takes minutes.
            </p>
          </div>
          <Link href="/clients" className="btn btn-secondary btn-sm">
            Manage clients
          </Link>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          {cards.map((c) => (
            <ClientCard key={c.client.id} card={c} />
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <header className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="display text-lg">Recent runs</h2>
            <Link href="/runs" className="text-sm text-pine hover:underline">
              All runs
            </Link>
          </header>
          <div className="p-5">
            {runs.length === 0 ? (
              <p className="text-sm text-ink-3">Nothing has been run yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {runs.slice(0, 6).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                    <StatusTag status={r.status} />
                    <Link href={`/runs/${r.id}`} className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.clientName}</span>
                      <span className="block text-xs text-ink-3">
                        {r.stepsDone} of {r.stepsTotal} steps · {duration(r.startedAt, r.finishedAt)}
                      </span>
                    </Link>
                    <span className="shrink-0 text-xs text-ink-3">
                      {timeAgo(r.finishedAt ?? r.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="card overflow-hidden">
          <header className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="display text-lg">Published to a live site</h2>
            <Link href="/fixes" className="text-sm text-pine hover:underline">
              Apply fixes
            </Link>
          </header>
          <div className="p-5">
            {recentChanges.length === 0 ? (
              <p className="text-sm text-ink-3">
                Nothing has been written to a client&rsquo;s website yet. Connect one on the Apply
                fixes screen and approved changes publish from here.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {recentChanges.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start gap-3 py-3">
                    <StatusTag status={c.status} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {c.clientName}
                        <span className="ml-2 font-normal text-ink-3">
                          {FIELD_LABEL[c.field] ?? c.field}
                        </span>
                      </p>
                      <p className="line-clamp-1 text-xs text-ink-3">{c.appliedValue}</p>
                    </div>
                    <span className="shrink-0 text-xs text-ink-3">{timeAgo(c.appliedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

const FIELD_LABEL: Record<string, string> = {
  meta_title: 'page title',
  meta_description: 'search description',
  copy: 'body copy',
}

/**
 * One figure summed across every client.
 *
 * Deliberately not a link. Each of these totals four businesses together, and
 * every screen it could lead to shows exactly one of them — so "13 critical
 * findings" would open a page listing 2 of them. A number and a destination
 * that disagree is worse than a number that goes nowhere; the per-client
 * figures below are where the drilling-in happens.
 */
function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: React.ReactNode
  hint: string
  tone: 'neutral' | 'good' | 'bad' | 'warn' | 'info'
}) {
  const colour = {
    neutral: 'text-ink',
    good: 'text-moss-deep',
    bad: 'text-rose',
    warn: 'text-amber',
    info: 'text-sky',
  }[tone]

  return (
    <div className="card p-5">
      <div className="eyebrow">{label}</div>
      <div className={`display mt-2 text-3xl tabular-nums ${colour}`}>{value}</div>
      <div className="mt-1 text-sm text-ink-3">{hint}</div>
    </div>
  )
}

function AttentionCard({ item }: { item: Attention }) {
  const skin = {
    bad: 'border-rose/25 bg-rose-soft',
    warn: 'border-amber/25 bg-amber-soft',
    info: 'border-sky/25 bg-sky-soft',
  }[item.tone]
  const text = { bad: 'text-rose', warn: 'text-amber', info: 'text-sky' }[item.tone]

  return (
    <article className={`flex flex-col rounded-xl border p-5 ${skin}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="neutral">{item.clientName}</Pill>
      </div>
      <p className={`mt-2 text-sm font-semibold ${text}`}>{item.headline}</p>
      <p className="mt-1 flex-1 text-sm text-ink-2">{item.detail}</p>
      <div className="mt-4">
        {/*
          Switches to that client on the way, because every per-client screen
          reads the cookie — a plain link would open somebody else's findings
          under this card's heading.
        */}
        <SwitchToClient clientId={item.clientId} to={item.href} label={item.action} />
      </div>
    </article>
  )
}

/** The very first screen anybody sees, before a single client exists. */
function FirstRun() {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <h1 className="display text-4xl">Find out whether AI names your clients</h1>
      <p className="mt-3 text-ink-2">
        SEOmyze asks the AI engines the questions real customers ask, records who gets recommended,
        crawls whoever that turns out to be, and writes the changes that close the gap — then
        publishes them to the client&rsquo;s own site.
      </p>

      <ol className="mt-8 space-y-4">
        {[
          {
            title: 'Add a client',
            body: 'Paste a website and a Google listing. Everything else is read off those.',
          },
          {
            title: 'Start a run',
            body: 'It reads the site, asks the engines, profiles the competitors and builds the fix list.',
          },
          {
            title: 'Publish the fixes',
            body: 'Connect the site once and approved changes go live from here, each one reversible.',
          },
        ].map((s, i) => (
          <li key={s.title} className="card flex gap-4 p-5">
            <span className="display w-6 shrink-0 text-xl text-ink-3">{i + 1}</span>
            <div>
              <p className="font-semibold">{s.title}</p>
              <p className="text-sm text-ink-2">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8">
        <Link href="/clients/new" className="btn btn-primary">
          Add your first client
        </Link>
      </div>

      <Empty title="Nothing is hardcoded to any one business">
        Name, services, places, phone numbers and the name variants the engines have to match are
        all read per client. A local service business and an online store are handled differently,
        and neither is assumed.
      </Empty>
    </div>
  )
}
