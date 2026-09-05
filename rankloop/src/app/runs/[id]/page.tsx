import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRunDetail } from '@/lib/run-queries'
import { STEP_BY_KEY, type StepKey } from '@/lib/pipeline'
import { MAX_PARALLEL_RUNS } from '@/lib/runner'
import { cancelRunAction } from '../../_actions/runs'
import { PageHeader, StatusTag, timeAgo, duration } from '../../_components/ui'
import { AutoRefresh } from '../../_components/auto-refresh'

export const dynamic = 'force-dynamic'

/**
 * One run, step by step, with the output each step produced.
 *
 * The log is shown rather than summarised. When a measurement sweep fails it is
 * almost always for a reason only the output explains — an engine asking to log
 * in again, a site that stopped answering — and a status word alone would send
 * the operator to a terminal to find out what a status word could not say.
 */
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const run = getRunDetail(Number(id))
  if (!run) notFound()

  const live = run.status === 'running' || run.status === 'queued'

  return (
    <div>
      <AutoRefresh active={live} everyMs={2500} />

      <PageHeader
        title={`Run #${run.id}`}
        subtitle={
          <>
            <Link href="/clients" className="font-medium text-pine hover:underline">
              {run.clientName}
            </Link>{' '}
            · {run.clientDomain}
            {run.label && <> · {run.label}</>}
          </>
        }
        actions={
          <>
            <StatusTag status={run.status} />
            {live && (
              <form action={cancelRunAction}>
                <input type="hidden" name="runId" value={run.id} />
                <button type="submit" className="btn btn-danger">
                  Stop this run
                </button>
              </form>
            )}
            <Link href="/runs" className="btn btn-secondary">
              All runs
            </Link>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Meta label="Started" value={run.startedAt ? timeAgo(run.startedAt) : 'not yet'} />
        <Meta label="Elapsed" value={duration(run.startedAt, run.finishedAt)} />
        <Meta label="Steps done" value={`${run.stepsDone} of ${run.stepsTotal}`} />
        <Meta
          label="Now"
          value={
            run.currentStep
              ? STEP_BY_KEY.get(run.currentStep as StepKey)?.label ?? run.currentStep
              : run.status === 'done'
                ? 'finished'
                : '—'
          }
        />
      </div>

      {run.status === 'queued' && (
        <div className="mb-6 rounded-xl border border-line bg-sink p-5">
          <p className="text-sm font-semibold">Waiting its turn</p>
          <p className="mt-1 text-sm text-ink-2">
            {MAX_PARALLEL_RUNS} clients are worked at a time, and that many are already going.
            This run starts itself the moment one of them finishes — there is nothing to press.
          </p>
        </div>
      )}

      {run.error && (
        <div className="mb-6 rounded-xl border border-rose/25 bg-rose-soft p-5">
          <p className="text-sm font-semibold text-rose">This run stopped early</p>
          <p className="mt-1 text-sm text-ink-2">{run.error}</p>
        </div>
      )}

      <div className="space-y-4">
        {run.steps.map((step, i) => {
          const def = STEP_BY_KEY.get(step.stepKey as StepKey)
          const openByDefault =
            step.status === 'running' || step.status === 'waiting' || step.status === 'failed'
          return (
            <details key={step.id} open={openByDefault} className="card overflow-hidden">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-5 py-4 marker:content-none">
                <span className="display w-5 shrink-0 text-sm text-ink-3">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{def?.label ?? step.stepKey}</span>
                  <span className="block text-sm text-ink-3">{def?.description}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-ink-3">
                  {step.startedAt ? duration(step.startedAt, step.finishedAt) : def?.duration}
                </span>
                <StatusTag status={step.status} />
              </summary>

              <div className="border-t border-line bg-sink/50 px-5 py-4">
                {step.log.trim() ? (
                  <pre className="logline max-h-96 overflow-auto text-ink-2">{step.log.trim()}</pre>
                ) : (
                  <p className="text-sm text-ink-3">
                    {step.status === 'pending'
                      ? 'Waiting for the steps above to finish.'
                      : step.status === 'skipped'
                        ? 'Not run, because an earlier step stopped the run.'
                        : 'No output yet.'}
                  </p>
                )}
                {step.exitCode !== null && step.exitCode !== 0 && (
                  <p className="mt-3 text-xs text-rose">Exited with code {step.exitCode}.</p>
                )}
              </div>
            </details>
          )
        })}
      </div>

      {run.status === 'done' && (
        <div className="mt-8 rounded-xl border border-moss/25 bg-moss-soft p-5">
          <p className="text-sm font-semibold text-moss-deep">Run finished</p>
          <p className="mt-1 text-sm text-ink-2">
            The findings, recommendations and client report are all rebuilt from what this run
            collected.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/overview" className="btn btn-primary btn-sm">
              Overview
            </Link>
            <Link href="/findings" className="btn btn-secondary btn-sm">
              Findings
            </Link>
            <Link href="/fixes" className="btn btn-secondary btn-sm">
              Apply the fixes
            </Link>
            <Link href="/report" className="btn btn-secondary btn-sm">
              Client report
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-quiet px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  )
}
