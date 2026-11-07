import type { ReactNode } from 'react'

/**
 * The portal's own primitives.
 *
 * Separate from the console's on purpose. The console is read by someone who
 * runs the tool all day and wants density; the portal is read a few times a
 * month by a business owner who wants to know what to do next. The two
 * surfaces are allowed to drift apart.
 */

export function PortalHeader({ title, lede }: { title: string; lede?: string }) {
  return (
    <div>
      <h1 className="display text-3xl">{title}</h1>
      {lede && <p className="mt-1 text-sm text-ink-3">{lede}</p>}
    </div>
  )
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="eyebrow">{label}</div>
      <div className="display mt-1 text-3xl text-pine-deep">{value}</div>
      {note && <div className="mt-1 text-xs text-ink-3">{note}</div>}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-card/50 p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mt-1 text-sm text-ink-3">{children}</p>}
    </div>
  )
}

const TONE: Record<string, string> = {
  approved: 'bg-pine text-white',
  rejected: 'bg-sink text-ink-2',
  pending: 'bg-amber-soft text-amber',
}

export function DecisionPill({ decision }: { decision: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TONE[decision] ?? TONE.pending}`}>
      {decision}
    </span>
  )
}
