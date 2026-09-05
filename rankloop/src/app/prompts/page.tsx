import Link from 'next/link'
import { getPromptGrid } from '@/lib/queries'
import { NoClient } from '../_components/no-client'
import { NeedsRun } from '../_components/ui'
import { activeClient } from '@/lib/active-client'

export const dynamic = 'force-dynamic'

export default async function PromptsPage() {
  const client = await activeClient()
  if (!client) return <NoClient />
  const { engines, rows } = getPromptGrid(client)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl">Answers</h1>
        <p className="mt-1 text-sm text-ink-3">
          Every question, every engine. Green means the client was named. Click a cell to read the
          raw answer and see the screenshot.
        </p>
      </div>

      {engines.length === 0 && (
        <NeedsRun
          what="No answers collected yet"
          step="Asking the engines is part of a full run, and it needs a browser already signed into each of them."
        />
      )}

      <div className="overflow-x-auto card">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-4 py-3">Question</th>
              <th className="px-3 py-3">City</th>
              <th className="px-3 py-3">Intent</th>
              {engines.map((e) => (
                <th key={e} className="px-3 py-3 text-center">
                  {e}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-sink">
                <td className="max-w-md px-4 py-3">
                  <span className="line-clamp-2">{r.text}</span>
                  {r.persona === 'older' && (
                    <span className="mt-1 inline-block rounded bg-sink px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
                      older-customer phrasing
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-ink-3">{r.locationName}</td>
                <td className="px-3 py-3 text-ink-3">{r.intent}</td>
                {engines.map((e) => {
                  const run = r.runs[e] as
                    | { id: number; ok: boolean; named: boolean; error: string | null }
                    | null
                  if (!run) {
                    return (
                      <td key={e} className="px-3 py-3 text-center text-line-2">
                        –
                      </td>
                    )
                  }
                  const cls = !run.ok
                    ? 'bg-sink text-ink-3'
                    : run.named
                      ? 'bg-moss-soft text-moss-deep'
                      : 'bg-rose-soft text-rose'
                  return (
                    <td key={e} className="px-3 py-3 text-center">
                      <Link
                        href={`/answers/${run.id}`}
                        className={`inline-block rounded px-2 py-1 text-xs font-medium ${cls}`}
                        title={run.error ?? undefined}
                      >
                        {!run.ok ? 'failed' : run.named ? 'named' : 'absent'}
                      </Link>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
