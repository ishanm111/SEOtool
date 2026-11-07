import Link from 'next/link'
import { getRecommendations } from '@/lib/queries'
import { NoClient } from '../_components/no-client'
import { NeedsRun } from '../_components/ui'
import { activeClient } from '@/lib/active-client'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  new_page: 'New page',
  blog_post: 'Blog post',
  copy: 'Copy rewrite',
  meta_title: 'Page title',
  meta_description: 'Meta description',
  schema: 'Structured data',
}

const KIND_ORDER = ['new_page', 'blog_post', 'copy', 'meta_title', 'meta_description', 'schema']

function Placeholders({ text }: { text: string }) {
  // Highlight every [[FILL: …]] so what still needs a human is impossible to miss.
  const parts = text.split(/(\[\[FILL:[^\]]*\]\])/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('[[FILL:') ? (
          <mark key={i} className="rounded bg-amber-soft px-1 text-amber">
            {part.replace(/^\[\[FILL:\s*/, '').replace(/\]\]$/, '')}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

export default async function RecommendationsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>
}) {
  const client = await activeClient()
  if (!client) return <NoClient />

  const { kind } = await searchParams
  const data = getRecommendations(client, kind)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl">Recommendations</h1>
        <p className="mt-1 text-sm text-ink-3">
          What to change, ranked by measured impact. Copy, metadata, structured data and pages that do
          not exist yet — never design.
        </p>
      </div>

      {data.total === 0 ? (
        <NeedsRun
          what="No recommendations yet"
          step="The fix list is built from the site read and the findings."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/generated"
              className={`rounded-md border px-3 py-1.5 text-sm ${
                !kind ? 'border-pine bg-pine text-white' : 'border-line-2 hover:bg-sink'
              }`}
            >
              All {data.total}
            </Link>
            {KIND_ORDER.filter((k) => data.byKind.some(([kk]) => kk === k)).map((k) => {
              const count = data.byKind.find(([kk]) => kk === k)?.[1] ?? 0
              return (
                <Link
                  key={k}
                  href={`/generated?kind=${k}`}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    kind === k ? 'border-pine bg-pine text-white' : 'border-line-2 hover:bg-sink'
                  }`}
                >
                  {KIND_LABEL[k] ?? k} {count}
                </Link>
              )
            })}
          </div>

          {data.needingInput > 0 && (
            <div className="rounded-lg border border-amber/25 bg-amber-soft p-4 text-sm text-amber">
              <strong>
                {data.needingInput} of {data.total} need a fact from the business
              </strong>{' '}
              ({data.placeholders} highlighted gaps). Prices, warranties, response times and
              credentials are never invented — they have to be confirmed before anything is published.
            </div>
          )}

          <div className="space-y-4">
            {data.rows.slice(0, 60).map((r) => (
              <article key={r.id} className="card p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="pill bg-pine-soft text-pine-deep">
                    {KIND_LABEL[r.kind] ?? r.kind}
                  </span>
                  <span className="text-xs tabular-nums text-ink-3">priority {r.priority}</span>
                  {r.placeholderCount > 0 && (
                    <span className="rounded bg-amber-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber">
                      {r.placeholderCount} to fill in
                    </span>
                  )}
                  <span className="ml-auto truncate text-xs text-ink-3">{r.target}</span>
                </div>

                <p className="mt-3 text-sm text-ink-2">{r.reason}</p>

                {r.currentValue && (
                  <div className="mt-3 rounded border border-line bg-sink p-3">
                    <div className="eyebrow">Now</div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">
                      {r.currentValue.slice(0, 600)}
                      {r.currentValue.length > 600 && '…'}
                    </p>
                  </div>
                )}

                <div className="mt-2 rounded border border-moss/25 bg-moss-soft p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-moss-deep">
                    Proposed
                  </div>
                  <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-ink">
                    <Placeholders text={r.proposedValue} />
                  </pre>
                </div>
              </article>
            ))}
          </div>

          {data.rows.length > 60 && (
            <p className="text-sm text-ink-3">
              Showing 60 of {data.rows.length}. Filter by type above, or use{' '}
              <code className="rounded bg-sink px-1 py-0.5 text-xs">
                npm run recommend -- --show={kind ?? 'new_page'}
              </code>
            </p>
          )}
        </>
      )}
    </div>
  )
}
