import Link from 'next/link'
import type { ClientCard as CardData } from '@/lib/run-queries'
import { BUSINESS_TYPE_LABELS } from '@/config'
import { Pill, StatusTag, timeAgo } from './ui'
import { RunControls } from './run-controls'
import { StartRun } from './start-run'
import { SwitchToClient } from './switch-to-client'

/**
 * One client, as seen from outside.
 *
 * Carries the three figures that decide whether it needs attention today, and
 * the button that does something about it. Shared by the home screen and the
 * client list so the two can never drift into showing different numbers for the
 * same business.
 */
export function ClientCard({ card: c }: { card: CardData }) {
  const pct = c.answerCount > 0 ? Math.round((c.namedCount / c.answerCount) * 100) : null

  return (
    <article className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="display truncate text-xl">{c.client.name}</h2>
          <a
            href={c.client.homepageUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-ink-3 hover:text-pine hover:underline"
          >
            {c.client.domain}
          </a>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <Pill tone="neutral">{BUSINESS_TYPE_LABELS[c.client.businessType].label}</Pill>
          <Pill tone="neutral">{c.client.platform}</Pill>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 border-y border-line py-4">
        <Figure
          label="Named in AI"
          value={pct === null ? '—' : `${pct}%`}
          hint={c.answerCount === 0 ? 'not measured' : `${c.namedCount} of ${c.answerCount} answers`}
          tone={pct === null ? 'neutral' : pct === 0 ? 'bad' : pct > 30 ? 'good' : 'warn'}
        />
        <Figure
          label="Critical"
          value={c.criticalFindings}
          hint={`${c.findingCount} findings`}
          tone={c.criticalFindings > 0 ? 'bad' : 'good'}
        />
        <Figure
          label="Fixes ready"
          value={c.recommendationCount}
          hint={c.appliedFixes > 0 ? `${c.appliedFixes} applied` : 'none applied yet'}
          tone={c.recommendationCount > 0 ? 'info' : 'neutral'}
        />
      </div>

      <dl className="mt-4 space-y-1.5 text-sm">
        <Row
          label="Service area"
          value={
            c.locations.length
              ? c.locations.slice(0, 4).join(', ') +
                (c.locations.length > 4 ? ` +${c.locations.length - 4}` : '')
              : c.client.businessType === 'ecommerce'
                ? 'online store — no locations'
                : 'none set'
          }
        />
        <Row
          label="Google listing"
          value={
            c.client.gbpRating !== null
              ? `${c.client.gbpRating}★ · ${c.client.gbpReviewCount ?? '?'} reviews${
                  c.client.gbpHasWebsite === false ? ' · no website attached' : ''
                }`
              : 'not recorded'
          }
        />
        <Row
          label="Site pages"
          value={`${c.pageCount} read · ${c.competitorCount} competitors profiled`}
        />
        <Row
          label="Editor access"
          value={
            c.hasCredentials ? 'connected — fixes can be published from here' : 'not connected'
          }
        />
      </dl>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="text-xs text-ink-3">
          {c.activeRun ? (
            <Link href={`/runs/${c.activeRun.id}`} className="inline-flex items-center gap-2">
              <StatusTag status={c.activeRun.status} />
              <span>
                step {c.activeRun.stepsDone + 1} of {c.activeRun.stepsTotal}
              </span>
            </Link>
          ) : c.lastRun ? (
            <Link href={`/runs/${c.lastRun.id}`} className="inline-flex items-center gap-2">
              <StatusTag status={c.lastRun.status} />
              <span>last run {timeAgo(c.lastRun.finishedAt ?? c.lastRun.createdAt)}</span>
            </Link>
          ) : (
            <span>never run</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {c.activeRun && <RunControls runId={c.activeRun.id} status={c.activeRun.status} />}
          <SwitchToClient clientId={c.client.id} />
          <StartRun
            clientId={c.client.id}
            clientName={c.client.name}
            disabled={Boolean(c.activeRun)}
            disabledReason={c.activeRun ? `Run #${c.activeRun.id} is already going` : undefined}
          />
        </div>
      </div>
    </article>
  )
}

function Figure({
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
  const color = {
    neutral: 'text-ink',
    good: 'text-moss-deep',
    bad: 'text-rose',
    warn: 'text-amber',
    info: 'text-sky',
  }[tone]
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className={`display mt-1 text-2xl tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-ink-3">{hint}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-xs uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-ink-2">{value}</dd>
    </div>
  )
}
