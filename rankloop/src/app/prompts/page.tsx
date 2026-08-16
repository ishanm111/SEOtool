import Link from 'next/link'
import { getPromptGrid } from '@/lib/queries'
import { NoClient } from '../_components/no-client'
import { activeClient } from '@/lib/active-client'

export const dynamic = 'force-dynamic'

export default async function PromptsPage() {
  const client = await activeClient()
  if (!client) return <NoClient />
  const { engines, rows } = getPromptGrid(client)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Answers</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every question, every engine. Green means the client was named. Click a cell to read the
          raw answer and see the screenshot.
        </p>
      </div>

      {engines.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          No measurements yet. Log in once with{' '}
          <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">
            npx tsx src/scripts/login.ts
          </code>
          , then run{' '}
          <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">
            npx tsx src/scripts/measure.ts
          </code>
          .
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
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
          <tbody className="divide-y divide-zinc-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-zinc-50">
                <td className="max-w-md px-4 py-3">
                  <span className="line-clamp-2">{r.text}</span>
                  {r.persona === 'older' && (
                    <span className="mt-1 inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                      older-customer phrasing
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-zinc-500">{r.locationName}</td>
                <td className="px-3 py-3 text-zinc-500">{r.intent}</td>
                {engines.map((e) => {
                  const run = r.runs[e] as
                    | { id: number; ok: boolean; named: boolean; error: string | null }
                    | null
                  if (!run) {
                    return (
                      <td key={e} className="px-3 py-3 text-center text-zinc-300">
                        –
                      </td>
                    )
                  }
                  const cls = !run.ok
                    ? 'bg-zinc-100 text-zinc-500'
                    : run.named
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-red-50 text-red-700'
                  return (
                    <td key={e} className="px-3 py-3 text-center">
                      <Link
                        href={`/runs/${run.id}`}
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
