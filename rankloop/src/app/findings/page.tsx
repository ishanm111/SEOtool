import { getFindings } from '@/lib/queries'
import { NoClient } from '../_components/no-client'
import { activeClient } from '@/lib/active-client'

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

export default async function FindingsPage() {
  const client = await activeClient()
  if (!client) return <NoClient />
  const findings = getFindings(client)
  const siteLevel = findings.filter((f) => f.targetType !== 'paragraph')
  const paragraphLevel = findings.filter((f) => f.targetType === 'paragraph')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl">Findings</h1>
        <p className="mt-1 text-sm text-ink-3">
          Ranked by severity. Every rule traces to measured research, not opinion.
        </p>
      </div>

      <div className="space-y-4">
        {siteLevel.map((f) => (
          <article key={f.id} className={`rounded-lg border p-5 ${SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.low}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE_STYLE[f.severity]}`}>
                {f.severity}
              </span>
              <span className="eyebrow">
                {f.category}
              </span>
            </div>

            <p className="mt-3 text-sm font-medium leading-relaxed">{f.issue}</p>

            {f.proposedText && (
              <div className="mt-3 rounded border border-line bg-white p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-moss-deep">
                  What to do
                </div>
                <p className="mt-1 text-sm leading-relaxed">{f.proposedText}</p>
              </div>
            )}

            {f.evidence && (
              <p className="mt-3 text-xs text-ink-3">
                <span className="font-semibold">Evidence:</span> {f.evidence}
              </p>
            )}
          </article>
        ))}
      </div>

      {paragraphLevel.length > 0 && (
        <section className="space-y-3">
          <h2 className="display pt-4 text-xl">
            Paragraph-level fixes ({paragraphLevel.length})
          </h2>
          {paragraphLevel.map((f) => (
            <article key={f.id} className="card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE_STYLE[f.severity]}`}>
                  {f.severity}
                </span>
                {f.pageSlug && (
                  <span className="text-xs font-medium text-ink-3">/{f.pageSlug}</span>
                )}
              </div>
              <p className="mt-2 text-sm font-medium">{f.issue}</p>
              {f.currentText && (
                <div className="mt-3 rounded border border-line bg-sink p-3">
                  <div className="eyebrow">
                    Current text
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-ink-2">{f.currentText}</p>
                </div>
              )}
              {f.proposedText && (
                <div className="mt-2 rounded border border-moss/25 bg-moss-soft p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-moss-deep">
                    What to do
                  </div>
                  <p className="mt-1 text-sm leading-relaxed">{f.proposedText}</p>
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
