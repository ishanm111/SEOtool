'use client'

import { useFormStatus } from 'react-dom'
import { cancelRunAction, pauseRunAction, resumeRunAction } from '../_actions/runs'

/**
 * Pause, resume and stop, wherever a run is showing.
 *
 * The two are genuinely different things and both are needed. Stopping keeps
 * whatever the run wrote and gives up the rest — the next attempt starts from
 * the beginning. Pausing holds the run where it stands with the child process
 * alive and the signed-in browser still spoken for, so resuming carries on from
 * the question it stopped on. Asking the engines takes the better part of an
 * hour and is not resumable from the middle by any other means, so "stop it for
 * ten minutes and give me my machine back" and "abandon this run" cannot be the
 * same button.
 *
 * Pause takes effect at the next question rather than instantly, which the
 * button says, because a pause landing mid-answer would lose the answer being
 * collected.
 */
export function RunControls({
  runId,
  status,
  size = 'sm',
}: {
  runId: number
  status: string
  /** `sm` on a crowded client card, normal on the run's own page. */
  size?: 'sm' | 'md'
}) {
  if (status !== 'running' && status !== 'queued' && status !== 'paused') return null

  const cls = `btn ${size === 'sm' ? 'btn-sm' : ''}`

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'paused' ? (
        <form action={resumeRunAction}>
          <input type="hidden" name="runId" value={runId} />
          <Button className={`${cls} btn-primary`} idle="Resume run" busy="Resuming…" />
        </form>
      ) : (
        <form action={pauseRunAction}>
          <input type="hidden" name="runId" value={runId} />
          <Button
            className={`${cls} btn-secondary`}
            idle="Pause run"
            busy="Pausing…"
            title="Holds the run at the next question. The browser session stays open, so resuming carries on rather than starting the step again."
          />
        </form>
      )}

      <form
        action={cancelRunAction}
        onSubmit={(e) => {
          // Stopping cannot be undone: the step it was on starts from the
          // beginning next time, and for the engine questions that is an hour.
          if (!confirm('Stop this run? What it has already written is kept, but the step it is on starts again next time.')) {
            e.preventDefault()
          }
        }}
      >
        <input type="hidden" name="runId" value={runId} />
        <Button className={`${cls} btn-danger`} idle="Stop run" busy="Stopping…" />
      </form>
    </div>
  )
}

function Button({
  className,
  idle,
  busy,
  title,
}: {
  className: string
  idle: string
  busy: string
  title?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={className} disabled={pending} title={title}>
      {pending ? busy : idle}
    </button>
  )
}
