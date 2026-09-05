import { eq } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'

/**
 * Lets a long step be held where it stands, and carry on from there.
 *
 * Stopping a run is easy: kill the child. Pausing one is not, because the step
 * that matters takes the better part of an hour and nothing about it is
 * resumable — a measurement restarted from the top re-asks every question it
 * already asked, at human pacing, of engines that rate-limit. So a pause has to
 * happen *inside* the step, between two questions, with the process alive and
 * the browser session intact.
 *
 * The signal travels through the database rather than through a signal: the
 * step is a separate process spawned by the console, both ends already have the
 * same SQLite file open, and a row survives the dev server reloading underneath
 * a run that is still going.
 *
 * Suspending the process instead (SIGSTOP) was the obvious alternative and is
 * wrong here: every timeout inside Playwright is measured against the wall
 * clock, so a run held for ten minutes wakes up to a page that timed out while
 * it slept, and the answers it was in the middle of collecting are lost.
 */

/** How often a held step asks whether it may carry on. */
const POLL_MS = 1500

/**
 * One connection for the life of the process.
 *
 * Opening a new one per check leaked a database handle and a pair of exit
 * handlers every second and a half — Node started warning about the listeners
 * long before SQLite would have complained about the handles.
 */
let cached: ReturnType<typeof openDb> | null = null
function gateDb() {
  cached ??= openDb()
  return cached
}

/** Reads the run's own status. Null when the run cannot be found. */
function statusOf(runId: number): string | null {
  try {
    const db = gateDb()
    const row = db
      .select({ status: schema.pipelineRuns.status })
      .from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.id, runId))
      .all()[0]
    return row?.status ?? null
  } catch {
    /**
     * A step must never die because the status could not be read. The worst
     * case of guessing "not paused" is that a pause takes effect at the next
     * question rather than this one; the worst case of throwing is losing an
     * hour of measurement to a locked database.
     */
    return null
  }
}

/**
 * Blocks while the run is paused, and returns as soon as it is not.
 *
 * Called between units of work — between questions, not inside one — so a
 * pause never lands in the middle of an answer being collected.
 *
 * `runId` is null when the script was started from the command line rather than
 * by the console. There is no run row to consult and nothing to wait for, so it
 * returns immediately: the command line already has Ctrl-C.
 */
export async function waitIfPaused(
  runId: number | null,
  log: (message: string) => void = console.log,
): Promise<void> {
  if (runId === null) return
  if (statusOf(runId) !== 'paused') return

  log('\n  paused — holding here. Nothing collected so far is lost; resume from the console.')
  const heldFrom = Date.now()

  while (statusOf(runId) === 'paused') {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

  const seconds = Math.round((Date.now() - heldFrom) / 1000)
  log(`  resumed after ${seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} min`}.\n`)
}
