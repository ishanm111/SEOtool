import { getFindings } from '@/lib/queries'
import { NoClient } from '../_components/no-client'
import { activeClient } from '@/lib/active-client'

export const dynamic = 'force-dynamic'

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'border-red-300 bg-red-50',
  high: 'border-orange-300 bg-orange-50',
  medium: 'border-amber-200 bg-amber-50',
  low: 'border-zinc-200 bg-white',
}

const BADGE_STYLE: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-amber-400 text-amber-950',
  low: 'bg-zinc-200 text-zinc-700',
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
        <h1 className="text-2xl font-semibold tracking-tight">Findings</h1>
        <p className="mt-1 text-sm text-zinc-500">
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
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {f.category}
              </span>
            </div>

            <p className="mt-3 text-sm font-medium leading-relaxed">{f.issue}</p>

            {f.proposedText && (
              <div className="mt-3 rounded border border-zinc-200 bg-white p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                  What to do
                </div>
                <p className="mt-1 text-sm leading-relaxed">{f.proposedText}</p>
              </div>
            )}

            {f.evidence && (
              <p className="mt-3 text-xs text-zinc-500">
                <span className="font-semibold">Evidence:</span> {f.evidence}
              </p>
            )}
          </article>
        ))}
      </div>

      {paragraphLevel.length > 0 && (
        <section className="space-y-3">
          <h2 className="pt-4 text-lg font-semibold tracking-tight">
            Paragraph-level fixes ({paragraphLevel.length})
          </h2>
          {paragraphLevel.map((f) => (
            <article key={f.id} className="rounded-lg border border-zinc-200 bg-white p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE_STYLE[f.severity]}`}>
                  {f.severity}
                </span>
                {f.pageSlug && (
                  <span className="text-xs font-medium text-zinc-500">/{f.pageSlug}</span>
                )}
              </div>
              <p className="mt-2 text-sm font-medium">{f.issue}</p>
              {f.currentText && (
                <div className="mt-3 rounded border border-zinc-200 bg-zinc-50 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    Current text
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-700">{f.currentText}</p>
                </div>
              )}
              {f.proposedText && (
                <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
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
