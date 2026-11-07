import { redirect } from 'next/navigation'
import { currentPortalSession } from '@/portal/auth'
import { getFindings } from '@/lib/queries'
import { Empty, PortalHeader } from '../../_components/ui'

export const dynamic = 'force-dynamic'

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'border-rose/30 bg-rose-soft',
  high: 'border-clay/30 bg-clay-soft',
  medium: 'border-amber/25 bg-amber-soft',
  low: 'border-line bg-white',
}

const BADGE_STYLE: Record<string, string> = {
  critical: 'bg-rose text-white',
  high: 'bg-clay text-white',
  medium: 'bg-amber-soft text-amber',
  low: 'bg-sink text-ink-2',
}

/**
 * What is standing between this business and being recommended.
 *
 * The same findings the operator sees, ranked the same way, with the internal
 * target identifiers left off: a client needs to know what is wrong and where,
 * not which row of which table it was derived from.
 */
export default async function PortalFindings() {
  const session = await currentPortalSession()
  if (!session) redirect('/portal/login')

  const findings = getFindings(session.client)

  if (findings.length === 0) {
    return (
      <div className="space-y-6">
        <PortalHeader title="What we found" />
        <Empty title="No findings yet.">They appear after your first full run.</Empty>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PortalHeader
        title="What we found"
        lede="Ranked worst first. Each one is a reason an AI assistant passed you over."
      />

      <div className="space-y-4">
        {findings.map((f) => (
          <article
            key={f.id}
            className={`rounded-lg border p-5 ${SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.low}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE_STYLE[f.severity]}`}
              >
                {f.severity}
              </span>
              <span className="eyebrow">{f.category}</span>
              {f.pageSlug && <span className="text-xs text-ink-3">{f.pageSlug}</span>}
            </div>

            <p className="mt-3 text-sm font-medium leading-relaxed">{f.issue}</p>

            {f.proposedText && (
              <div className="mt-3 rounded border border-line bg-white/70 p-3">
                <div className="eyebrow mb-1">What to do</div>
                <p className="text-sm leading-relaxed">{f.proposedText}</p>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}
