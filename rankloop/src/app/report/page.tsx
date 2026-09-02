import fs from 'node:fs'
import { activeClient } from '@/lib/active-client'
import { reportFileFor } from '@/lib/report-file'
import { NoClient } from '../_components/no-client'

export const dynamic = 'force-dynamic'

/**
 * The client-facing audit, shown inside the dashboard.
 *
 * Deliberately the file itself in a frame rather than a React re-rendering of
 * the same data: the report is the deliverable, and the only way to be sure of
 * what a client will see is to look at exactly what gets sent.
 */
export default async function ReportPage() {
  const client = await activeClient()
  if (!client) return <NoClient />

  const file = reportFileFor(client.domain)
  const exists = fs.existsSync(file)
  const generatedOn = exists ? fs.statSync(file).mtime.toLocaleString() : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Client report</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {exists
              ? `The audit as ${client.name} would receive it. Generated ${generatedOn}.`
              : `No report has been generated for ${client.name} yet.`}
          </p>
        </div>
        {exists && (
          <a
            href={`/api/report?domain=${encodeURIComponent(client.domain)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
          >
            Open full page
          </a>
        )}
      </div>

      {exists ? (
        <iframe
          title={`AI visibility audit for ${client.name}`}
          src={`/api/report?domain=${encodeURIComponent(client.domain)}`}
          // Inline height rather than a utility class: the frame has to fill the
          // viewport whatever the surrounding stylesheet does, and a report that
          // renders 150px tall reads as a broken report.
          style={{ height: '80vh' }}
          className="w-full rounded-lg border border-zinc-200 bg-white"
        />
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
          <p>Generate one, then reload this page:</p>
          <pre className="mt-3 rounded bg-zinc-900 px-4 py-3 text-xs text-zinc-100">
            npm run report -- --client={client.id}
          </pre>
        </div>
      )}
    </div>
  )
}
