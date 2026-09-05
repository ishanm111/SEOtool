import Link from 'next/link'
import { listRuns } from '@/lib/run-queries'
import { STEP_BY_KEY } from '@/lib/pipeline'
import { PageHeader, StatusTag, Empty, timeAgo, duration } from '../_components/ui'
import { AutoRefresh } from '../_components/auto-refresh'

export const dynamic = 'force-dynamic'

/**
 * Every run ever started, newest first.
 *
 * Across all clients rather than only the one being viewed: the question this
 * page answers is "what is the machine doing right now", and that is not a
 * per-client question.
 */
export default function RunsPage() {
  const runs = listRuns()
  const going = runs.filter((r) => r.status === 'running').length
  const queued = runs.filter((r) => r.status === 'queued').length
  const anyLive = going + queued > 0

  return (
    <div>
      <AutoRefresh active={anyLive} />
      <PageHeader
        title="Runs"
        subtitle={
          anyLive
            ? `${going} running${queued > 0 ? `, ${queued} queued behind them` : ''}. Clients are worked side by side; only the engine questions take turns, because there is one signed-in browser.`
            : 'Each run is the same sequence of scripts the command line runs, in order, stopping at the first failure.'
        }
        actions={
          <Link href="/clients" className="btn btn-secondary">
            Start one from a client
          </Link>
        }
      />

      {runs.length === 0 ? (
        <Empty title="Nothing has been run yet">
          Open a client and press “Start a new run”. The first run reads their site, asks the
          engines and builds the report.
        </Empty>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-sink text-left">
              <tr className="text-xs uppercase tracking-wide text-ink-3">
                <th className="px-5 py-3 font-semibold">Run</th>
                <th className="px-5 py-3 font-semibold">Client</th>
                <th className="px-5 py-3 font-semibold">Progress</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Took</th>
                <th className="px-5 py-3 font-semibold">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.map((r) => (
                <tr key={r.id} className="transition hover:bg-sink/60">
                  <td className="px-5 py-3">
                    <Link href={`/runs/${r.id}`} className="font-semibold text-pine-deep">
                      #{r.id}
                    </Link>
                    {r.label && <div className="text-xs text-ink-3">{r.label}</div>}
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-medium">{r.clientName}</div>
                    <div className="text-xs text-ink-3">{r.clientDomain}</div>
                  </td>
                  <td className="px-5 py-3">
                    <ProgressBar done={r.stepsDone} total={r.stepsTotal} status={r.status} />
                    <div className="mt-1 text-xs text-ink-3">
                      {r.currentStep
                        ? STEP_BY_KEY.get(r.currentStep as never)?.label ?? r.currentStep
                        : `${r.stepsDone} of ${r.stepsTotal} steps`}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <StatusTag status={r.status} />
                  </td>
                  <td className="px-5 py-3 tabular-nums text-ink-2">
                    {duration(r.startedAt, r.finishedAt)}
                  </td>
                  <td className="px-5 py-3 text-ink-3">{timeAgo(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  )
}

function ProgressBar({ done, total, status }: { done: number; total: number; status: string }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const colour =
    status === 'failed' ? 'bg-rose' : status === 'done' ? 'bg-moss' : 'bg-pine'
  return (
    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-sink">
      <div className={`h-full rounded-full ${colour} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  )
}
