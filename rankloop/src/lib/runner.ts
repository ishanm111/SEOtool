import 'server-only'
import path from 'node:path'
import fs from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { PIPELINE, STEP_BY_KEY, isFinished, parseStepKeys, type StepKey } from './pipeline'
import { captureRunResult } from './snapshot'
import { loadFacts } from './facts'

/**
 * Runs a pipeline for one client and keeps the database in step with it.
 *
 * Each stage is spawned as the same script the command line runs, so the console
 * cannot quietly do something different from `npm run ingest`. Output is streamed
 * into the step row as it arrives: a run that takes an hour has to be watchable,
 * or an operator has no way to tell a slow engine from a stuck one.
 *
 * Progress lives in SQLite rather than in memory, so a page load after a server
 * restart still shows what happened rather than an empty screen.
 */

type Live = { child: ChildProcess | null; cancelled: boolean }

/**
 * Survives a hot reload. Without this the dev server would lose track of a
 * running child on every edit and leave an orphan writing to the database with
 * nothing able to stop it.
 */
const live: Map<number, Live> = ((globalThis as Record<string, unknown>).__seomyzeRuns ??=
  new Map()) as Map<number, Live>

/**
 * Several clients at once, up to a point.
 *
 * Nothing about the pipeline is single-client — each step is its own process
 * with its own database connection — so the only reasons to hold a run back are
 * the two below.
 *
 *  - `runs` caps how many clients are worked at the same time. Every step
 *    crawls something, and a machine asked to crawl fifteen sites at once
 *    finishes none of them sooner. Runs over the cap sit in `queued` and start
 *    themselves as slots free.
 *  - `browser` is capacity one and cannot be otherwise. "Ask the AI engines"
 *    drives a real, signed-in Chrome out of a single profile directory, and a
 *    second Chrome on the same profile does not start. So measurement steps
 *    take turns while everything around them still runs side by side — which is
 *    the whole point, since measurement is the step that takes the hour.
 */
export const MAX_PARALLEL_RUNS = Math.max(1, Number(process.env.RANKLOOP_MAX_PARALLEL_RUNS) || 3)

type Waiter = { runId: number; resume: (granted: boolean) => void }
type Gate = { capacity: number; held: Set<number>; waiting: Waiter[] }

const gates = ((globalThis as Record<string, unknown>).__seomyzeGates ??= {
  runs: { capacity: MAX_PARALLEL_RUNS, held: new Set<number>(), waiting: [] as Waiter[] },
  browser: { capacity: 1, held: new Set<number>(), waiting: [] as Waiter[] },
}) as { runs: Gate; browser: Gate }

/**
 * Takes a place at a gate, waiting if it is full.
 *
 * Resolves `false` only when the run was cancelled while queued, so a caller
 * can tell "my turn" from "never mind" without inspecting anything else.
 */
function enter(gate: Gate, runId: number, onQueued?: (holders: number[]) => void): Promise<boolean> {
  if (gate.held.has(runId) || gate.held.size < gate.capacity) {
    gate.held.add(runId)
    return Promise.resolve(true)
  }
  onQueued?.([...gate.held])
  return new Promise<boolean>((resume) => gate.waiting.push({ runId, resume }))
}

/**
 * Gives up a place and hands it straight to whoever is next.
 *
 * The place is handed over rather than released: leaving the gate momentarily
 * open would let a run that arrived later jump the queue.
 */
function leave(gate: Gate, runId: number) {
  if (!gate.held.delete(runId)) return
  const next = gate.waiting.shift()
  if (!next) return
  gate.held.add(next.runId)
  next.resume(true)
}

/** Wakes a queued run so it can notice it was cancelled while it waited. */
function abandon(gate: Gate, runId: number) {
  const i = gate.waiting.findIndex((w) => w.runId === runId)
  if (i >= 0) gate.waiting.splice(i, 1)[0].resume(false)
}

/** What is being worked on right now, for a console that says so plainly. */
export function runningNow(): { active: number; queued: number; browserHeldBy: number | null } {
  return {
    active: gates.runs.held.size,
    queued: gates.runs.waiting.length,
    browserHeldBy: [...gates.browser.held][0] ?? null,
  }
}

export type RunOptions = {
  /** Ask every question rather than the core subset. */
  full?: boolean
  /** Restrict the chat engines, e.g. ['chatgpt']. Empty means all of them. */
  engines?: string[]
  /** Extra competitor domains the engines named but never linked. */
  addCompetitors?: string[]
}

/** Where the pipeline scripts and the database live. */
const ROOT = process.cwd()

/**
 * The local tsx, not `npx tsx`.
 *
 * npx will happily reach for the network when it cannot resolve a binary, which
 * turns "start a run" into a silent stall on a machine that is offline.
 */
function tsxBinary(): string {
  const local = path.join(ROOT, 'node_modules', '.bin', 'tsx')
  if (!fs.existsSync(local)) {
    throw new Error(
      'tsx is not installed in this project, so the pipeline scripts cannot run. Run `npm install`.',
    )
  }
  return local
}

/**
 * Competitor domains the business named in the questionnaire.
 *
 * The engines only cite businesses they already rank, so a rival that is
 * beating the client everywhere but never gets linked would never be profiled.
 * The one person who reliably knows who that is, is the client.
 */
function competitorsFromFacts(clientId: number): string[] {
  try {
    const raw = loadFacts(db, clientId).known_competitors ?? ''
    return raw
      .split(',')
      .map((s) => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter((s) => s.includes('.'))
  } catch {
    // A missing answer must never stop a run from starting.
    return []
  }
}

function argsFor(step: StepKey, clientId: number, opts: RunOptions): string[] {
  const def = STEP_BY_KEY.get(step)
  if (!def) throw new Error(`unknown pipeline step: ${step}`)

  const args = [def.script, `--client=${clientId}`]

  // Every script that asks a question has a flag meaning "take the default",
  // because there is no terminal here to answer it in.
  if (step === 'prompts') args.push('--yes')

  if (step === 'measure') {
    if (opts.full) args.push('--all')
    if (opts.engines && opts.engines.length > 0) args.push(`--engines=${opts.engines.join(',')}`)
  }

  if (step === 'competitors') {
    const named = [
      ...new Set([...(opts.addCompetitors ?? []), ...competitorsFromFacts(clientId)]),
    ]
    if (named.length > 0) args.push(`--add=${named.join(',')}`)
  }

  return args
}

/**
 * Marks runs that were in flight when the process died.
 *
 * A row still saying "running" with no child process behind it is a lie the
 * dashboard would repeat forever. Anything not in this process's live map was
 * interrupted, by definition — nothing else starts runs.
 */
export function reconcileStaleRuns() {
  const stuck = db
    .select()
    .from(schema.pipelineRuns)
    .where(inArray(schema.pipelineRuns.status, ['running', 'queued']))
    .all()
    .filter((r) => !live.has(r.id))

  for (const run of stuck) {
    db.update(schema.pipelineRuns)
      .set({
        status: 'failed',
        error: 'The server restarted while this run was in progress, so it stopped part way.',
        finishedAt: new Date(),
      })
      .where(eq(schema.pipelineRuns.id, run.id))
      .run()

    db.update(schema.pipelineSteps)
      .set({ status: 'failed', finishedAt: new Date() })
      .where(
        and(
          eq(schema.pipelineSteps.runId, run.id),
          inArray(schema.pipelineSteps.status, ['running', 'waiting']),
        ),
      )
      .run()

    // A run killed by a restart never reached the capture at the end of
    // execute(), so it happens here instead. Whatever it managed to collect is
    // still worth remembering.
    try {
      captureRunResult(run.id, run.clientId)
    } catch {
      // History is a convenience; failing to write it must never stop a page
      // from rendering the run it belongs to.
    }
  }
  return stuck.length
}

export function isRunning(runId: number) {
  return live.has(runId)
}

export function activeRunForClient(clientId: number): number | null {
  const row = db
    .select()
    .from(schema.pipelineRuns)
    .where(
      and(
        eq(schema.pipelineRuns.clientId, clientId),
        inArray(schema.pipelineRuns.status, ['running', 'queued']),
      ),
    )
    .all()
    .find((r) => live.has(r.id))
  return row?.id ?? null
}

/**
 * Queues a run and starts it.
 *
 * Returns as soon as the rows exist — the work continues in the background so
 * the button that started it does not hold a request open for an hour.
 */
export function startRun(
  clientId: number,
  stepKeys: StepKey[],
  opts: RunOptions = {},
  label = '',
): number {
  reconcileStaleRuns()

  const existing = activeRunForClient(clientId)
  if (existing !== null) {
    throw new Error(`This client already has run #${existing} in progress.`)
  }

  const ordered = PIPELINE.filter((s) => stepKeys.includes(s.key)).map((s) => s.key)
  if (ordered.length === 0) throw new Error('A run needs at least one step.')

  const runId = db
    .insert(schema.pipelineRuns)
    .values({
      clientId,
      label,
      status: 'queued',
      stepKeys: JSON.stringify(ordered),
    })
    .returning({ id: schema.pipelineRuns.id })
    .all()[0].id

  db.insert(schema.pipelineSteps)
    .values(ordered.map((key, i) => ({ runId, stepKey: key, sortOrder: i, status: 'pending' })))
    .run()

  // Deliberately not awaited: the caller is a form submission, not the run.
  void execute(runId, clientId, ordered, opts)

  return runId
}

/**
 * Stops a run where it stands.
 *
 * The step that was mid-flight keeps whatever it had already written — these
 * scripts commit as they go, so a cancelled ingest leaves a partly-read site
 * rather than nothing, and the run says so.
 */
export function cancelRun(runId: number) {
  const entry = live.get(runId)
  if (!entry) {
    reconcileStaleRuns()
    return false
  }
  entry.cancelled = true
  entry.child?.kill('SIGTERM')
  /**
   * A run waiting for a free slot or for the browser has no child to kill.
   * Waking it is the only way it ever finds out it was stopped — otherwise it
   * would sit in the queue and then start the work it was cancelled out of.
   */
  abandon(gates.runs, runId)
  abandon(gates.browser, runId)
  return true
}

/** Appends output to a step, keeping only the tail a person would ever read. */
const MAX_LOG_CHARS = 200_000

function appendLog(stepId: number, chunk: string) {
  const current =
    db
      .select({ log: schema.pipelineSteps.log })
      .from(schema.pipelineSteps)
      .where(eq(schema.pipelineSteps.id, stepId))
      .all()[0]?.log ?? ''

  const next = current + chunk
  db.update(schema.pipelineSteps)
    .set({ log: next.length > MAX_LOG_CHARS ? next.slice(-MAX_LOG_CHARS) : next })
    .where(eq(schema.pipelineSteps.id, stepId))
    .run()
}

async function runStep(
  runId: number,
  stepId: number,
  args: string[],
): Promise<{ code: number; cancelled: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(tsxBinary(), args, {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    live.set(runId, { child, cancelled: live.get(runId)?.cancelled ?? false })

    /**
     * Output is buffered and flushed on a timer rather than written per chunk.
     * A measurement run emits thousands of lines, and one UPDATE per line would
     * make the database the slowest part of a job that is mostly waiting.
     */
    let buffer = ''
    const flush = () => {
      if (!buffer) return
      const pending = buffer
      buffer = ''
      appendLog(stepId, pending)
    }
    const timer = setInterval(flush, 700)

    const collect = (data: Buffer) => {
      buffer += data.toString()
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)

    const finish = (code: number) => {
      clearInterval(timer)
      flush()
      const cancelled = live.get(runId)?.cancelled === true
      resolve({ code, cancelled })
    }

    child.on('error', (err) => {
      buffer += `\n${err instanceof Error ? err.message : String(err)}\n`
      finish(1)
    })
    child.on('close', (code, signal) => finish(code ?? (signal ? 130 : 1)))
  })
}

async function execute(runId: number, clientId: number, steps: StepKey[], opts: RunOptions) {
  /**
   * Registered before the first `await`, not when the first child spawns.
   *
   * Every page read reconciles runs against this map, and a run queued behind
   * the parallel-run cap has no child process yet. Without a place here it
   * would be read as the wreckage of a server restart and failed on the spot.
   */
  live.set(runId, { child: null, cancelled: false })

  const startedNow = await enter(gates.runs, runId)
  if (!startedNow) {
    // Cancelled while queued: it never ran, and says so rather than claiming a
    // failure it never got as far as having.
    db.update(schema.pipelineSteps)
      .set({ status: 'skipped' })
      .where(eq(schema.pipelineSteps.runId, runId))
      .run()
    db.update(schema.pipelineRuns)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(eq(schema.pipelineRuns.id, runId))
      .run()
    live.delete(runId)
    return
  }

  db.update(schema.pipelineRuns)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(schema.pipelineRuns.id, runId))
    .run()

  const stepRows = db
    .select()
    .from(schema.pipelineSteps)
    .where(eq(schema.pipelineSteps.runId, runId))
    .all()
    .sort((a, b) => a.sortOrder - b.sortOrder)

  let failure: string | null = null
  let cancelled = false

  for (const row of stepRows) {
    // A run can be stopped between steps, or while queued for the browser.
    if (live.get(runId)?.cancelled) cancelled = true

    if (cancelled) {
      db.update(schema.pipelineSteps)
        .set({ status: 'skipped' })
        .where(eq(schema.pipelineSteps.id, row.id))
        .run()
      continue
    }

    const def = STEP_BY_KEY.get(row.stepKey as StepKey)

    /**
     * Only one run may drive the signed-in browser. Waiting for it is shown as
     * a state of its own rather than as "running", because an operator watching
     * a step sit still for forty minutes needs to know it is queued behind
     * another client and not stuck.
     */
    if (def?.usesBrowser) {
      const myTurn = await enter(gates.browser, runId, (holders) => {
        db.update(schema.pipelineSteps)
          .set({ status: 'waiting', startedAt: new Date() })
          .where(eq(schema.pipelineSteps.id, row.id))
          .run()
        appendLog(
          row.id,
          `Waiting for the signed-in browser — run #${holders[0]} is using it.\n` +
            `Only one client can be measured at a time. This step starts on its own as soon as that run is finished with the browser.\n\n`,
        )
      })
      if (!myTurn) {
        cancelled = true
        db.update(schema.pipelineSteps)
          .set({ status: 'skipped', finishedAt: new Date() })
          .where(eq(schema.pipelineSteps.id, row.id))
          .run()
        continue
      }
    }

    db.update(schema.pipelineSteps)
      .set({ status: 'running', startedAt: row.startedAt ?? new Date() })
      .where(eq(schema.pipelineSteps.id, row.id))
      .run()

    let result: { code: number; cancelled: boolean }
    try {
      result = await runStep(runId, row.id, argsFor(row.stepKey as StepKey, clientId, opts))
    } catch (err) {
      appendLog(row.id, `\n${err instanceof Error ? err.message : String(err)}\n`)
      result = { code: 1, cancelled: false }
    } finally {
      // Handed on the moment this step is done with it, not at the end of the
      // run: the steps after "ask the engines" need no browser, and the client
      // waiting for one should not be held up by a report being written.
      if (def?.usesBrowser) leave(gates.browser, runId)
    }

    if (result.cancelled) {
      cancelled = true
      db.update(schema.pipelineSteps)
        .set({ status: 'skipped', finishedAt: new Date(), exitCode: result.code })
        .where(eq(schema.pipelineSteps.id, row.id))
        .run()
      continue
    }

    const ok = result.code === 0
    db.update(schema.pipelineSteps)
      .set({ status: ok ? 'done' : 'failed', exitCode: result.code, finishedAt: new Date() })
      .where(eq(schema.pipelineSteps.id, row.id))
      .run()

    if (!ok) {
      failure = `"${def?.label ?? row.stepKey}" exited with code ${result.code}. Its output is below.`
      // Later steps read what this one was supposed to write, so continuing
      // would produce a report built on missing data rather than a shorter one.
      break
    }
  }

  const remaining = db
    .select()
    .from(schema.pipelineSteps)
    .where(and(eq(schema.pipelineSteps.runId, runId), eq(schema.pipelineSteps.status, 'pending')))
    .all()
  for (const r of remaining) {
    db.update(schema.pipelineSteps)
      .set({ status: 'skipped' })
      .where(eq(schema.pipelineSteps.id, r.id))
      .run()
  }

  db.update(schema.pipelineRuns)
    .set({
      status: cancelled ? 'cancelled' : failure ? 'failed' : 'done',
      error: failure,
      finishedAt: new Date(),
    })
    .where(eq(schema.pipelineRuns.id, runId))
    .run()

  /**
   * Recorded for every ending, not only a clean one. A run that failed half way
   * still moved the numbers up to the point it stopped, and a history with gaps
   * in it where the hard runs were is worse than no history.
   */
  try {
    captureRunResult(runId, clientId)
  } catch (err) {
    db.update(schema.pipelineRuns)
      .set({
        error:
          (failure ? `${failure} ` : '') +
          `The results of this run could not be recorded: ${err instanceof Error ? err.message : String(err)}`,
      })
      .where(eq(schema.pipelineRuns.id, runId))
      .run()
  }

  leave(gates.runs, runId)
  live.delete(runId)
}

export { parseStepKeys, isFinished }

/**
 * Deletes a run, its steps and its recorded result.
 *
 * Done in that order because the child rows reference the parent. Nothing the
 * run wrote to the client's own tables is touched: findings, recommendations
 * and the site read belong to the client, not to the run that produced them.
 */
export function deleteRun(runId: number) {
  db.delete(schema.runResults).where(eq(schema.runResults.runId, runId)).run()
  db.delete(schema.pipelineSteps).where(eq(schema.pipelineSteps.runId, runId)).run()
  db.delete(schema.pipelineRuns).where(eq(schema.pipelineRuns.id, runId)).run()
}

/** The client and step list of an earlier run, so it can be repeated exactly. */
export function previousRunSpec(runId: number): { clientId: number; stepKeys: StepKey[] } | null {
  const run = db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.id, runId)).all()[0]
  if (!run) return null
  const stepKeys = parseStepKeys(run.stepKeys)
  return stepKeys.length > 0 ? { clientId: run.clientId, stepKeys } : null
}
