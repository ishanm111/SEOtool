import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * The handful of shapes every screen is built from.
 *
 * Kept in one file so a status colour means the same thing everywhere — the
 * moment "failed" is rose on one page and amber on another, the colour stops
 * carrying information and becomes decoration.
 */

export type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'info' | 'brand'

const TONE_PILL: Record<Tone, string> = {
  neutral: 'bg-sink text-ink-2',
  good: 'bg-moss-soft text-moss-deep',
  bad: 'bg-rose-soft text-rose',
  warn: 'bg-amber-soft text-amber',
  info: 'bg-sky-soft text-sky',
  brand: 'bg-pine-soft text-pine-deep',
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink',
  good: 'text-moss-deep',
  bad: 'text-rose',
  warn: 'text-amber',
  info: 'text-sky',
  brand: 'text-pine-deep',
}

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill ${TONE_PILL[tone]}`}>{children}</span>
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="display text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: Tone
}) {
  return (
    <div className="card p-5">
      <div className="eyebrow">{label}</div>
      <div className={`display mt-2 text-3xl tabular-nums ${TONE_TEXT[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-sm text-ink-3">{hint}</div>}
    </div>
  )
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="display text-lg">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-3">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

/** A message that stands in for content, so an empty screen still says why. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-2 bg-sink/60 px-5 py-8 text-center">
      <p className="display text-base text-ink">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-ink-2">{children}</div>}
    </div>
  )
}

export function Callout({
  tone = 'warn',
  title,
  children,
}: {
  tone?: Tone
  title: string
  children?: ReactNode
}) {
  const skin: Record<Tone, string> = {
    neutral: 'border-line bg-sink',
    good: 'border-moss/25 bg-moss-soft',
    bad: 'border-rose/25 bg-rose-soft',
    warn: 'border-amber/25 bg-amber-soft',
    info: 'border-sky/25 bg-sky-soft',
    brand: 'border-pine/25 bg-pine-soft',
  }
  return (
    <div className={`rounded-xl border p-5 ${skin[tone]}`}>
      <p className={`text-sm font-semibold ${TONE_TEXT[tone]}`}>{title}</p>
      {children && <div className="mt-1 text-sm text-ink-2">{children}</div>}
    </div>
  )
}

/** Status dot + word, used for run and step state everywhere it appears. */
export function StatusTag({ status }: { status: string }) {
  const map: Record<string, { tone: Tone; label: string; live?: boolean }> = {
    queued: { tone: 'info', label: 'Queued' },
    running: { tone: 'brand', label: 'Running', live: true },
    paused: { tone: 'warn', label: 'Paused' },
    done: { tone: 'good', label: 'Done' },
    failed: { tone: 'bad', label: 'Failed' },
    cancelled: { tone: 'neutral', label: 'Stopped' },
    pending: { tone: 'neutral', label: 'Waiting' },
    waiting: { tone: 'info', label: 'Queued for the browser', live: true },
    skipped: { tone: 'neutral', label: 'Skipped' },
    ok: { tone: 'good', label: 'Connected' },
    untested: { tone: 'warn', label: 'Not checked' },
    applied: { tone: 'good', label: 'Applied' },
    reverted: { tone: 'neutral', label: 'Reverted' },
  }
  const s = map[status] ?? { tone: 'neutral' as Tone, label: status }
  return (
    <Pill tone={s.tone}>
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full bg-current ${s.live ? 'live-dot' : ''}`}
      />
      {s.label}
    </Pill>
  )
}

export function timeAgo(date: Date | null | undefined): string {
  if (!date) return '—'
  const secs = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString()
}

export function duration(from: Date | null | undefined, to: Date | null | undefined): string {
  if (!from) return '—'
  const end = to ?? new Date()
  const secs = Math.max(0, Math.round((end.getTime() - from.getTime()) / 1000))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

/**
 * The stand-in for a screen whose data has not been collected yet.
 *
 * Points at the button that would collect it. The console replaced a set of
 * terminal commands, and an empty screen quoting one of those commands would
 * send an operator somewhere the tool no longer needs them to go.
 */
export function NeedsRun({
  what,
  step,
}: {
  what: string
  step: string
}) {
  return (
    <Empty title={what}>
      {step} Start one from the client list — a run that skips the engines takes minutes.
      <div className="mt-4 flex justify-center gap-2">
        <Link href="/clients" className="btn btn-primary">
          Start a run
        </Link>
        <Link href="/runs" className="btn btn-secondary">
          See past runs
        </Link>
      </div>
    </Empty>
  )
}


/**
 * How far through a run is.
 *
 * Shared by the runs table and the client card: the same run showing two
 * different amounts of progress on two screens is the kind of thing that makes
 * an operator stop believing either of them.
 */
export function ProgressBar({
  done,
  total,
  status,
}: {
  done: number
  total: number
  status: string
}) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const colour =
    status === 'failed'
      ? 'bg-rose'
      : status === 'done'
        ? 'bg-moss'
        : status === 'paused'
          ? 'bg-amber'
          : 'bg-pine'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sink">
      <div className={`h-full rounded-full ${colour} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  )
}
