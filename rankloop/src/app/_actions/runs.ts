'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { cancelRun, deleteRun, previousRunSpec, startRun, type RunOptions } from '@/lib/runner'
import { ALL_STEP_KEYS, DESK_STEP_KEYS, STEP_BY_KEY, type StepKey } from '@/lib/pipeline'

/**
 * Starting and stopping a run from the console.
 *
 * The button hands off to the runner and returns immediately — a measurement
 * sweep takes the better part of an hour, and a form submission is not a place
 * to hold that open.
 */

export type RunFormState = { error: string | null }

/**
 * What several clients started together did.
 *
 * A batch is reported per client rather than as one verdict: starting nine of
 * ten and saying "started" hides the tenth, and saying "failed" hides the nine.
 */
export type BatchFormState = {
  error: string | null
  refused: { name: string; reason: string }[]
}

function stepsFrom(formData: FormData): StepKey[] {
  const preset = String(formData.get('preset') ?? 'full')
  if (preset === 'desk') return DESK_STEP_KEYS
  if (preset === 'custom') {
    const chosen = formData
      .getAll('steps')
      .map(String)
      .filter((k): k is StepKey => STEP_BY_KEY.has(k as StepKey))
    return chosen
  }
  return ALL_STEP_KEYS
}

/** The engine and depth choices, read the same way for one client or twenty. */
function optionsFrom(formData: FormData): RunOptions {
  return {
    full: formData.get('depth') === 'full',
    engines: formData.getAll('engines').map(String).filter(Boolean),
    addCompetitors: String(formData.get('addCompetitors') ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter(Boolean),
  }
}

export async function startRunAction(
  _prev: RunFormState,
  formData: FormData,
): Promise<RunFormState> {
  const clientId = Number(formData.get('clientId'))
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return { error: 'No client was given for this run.' }
  }

  const steps = stepsFrom(formData)
  if (steps.length === 0) return { error: 'Pick at least one step to run.' }

  let runId: number
  try {
    runId = startRun(
      clientId,
      steps,
      optionsFrom(formData),
      String(formData.get('label') ?? '').trim(),
    )
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  revalidatePath('/', 'layout')
  redirect(`/runs/${runId}`)
}

export async function cancelRunAction(formData: FormData) {
  const runId = Number(formData.get('runId'))
  if (Number.isInteger(runId)) cancelRun(runId)
  revalidatePath('/runs')
  revalidatePath(`/runs/${runId}`)
}

/**
 * Removes a run and everything recorded about it.
 *
 * A run in flight is stopped first — deleting the row underneath a running
 * child process would leave it writing to something that no longer exists.
 */
export async function deleteRunAction(formData: FormData) {
  const runId = Number(formData.get('runId'))
  if (!Number.isInteger(runId)) return
  cancelRun(runId)
  deleteRun(runId)
  revalidatePath('/history')
  revalidatePath('/runs')
  revalidatePath('/clients')
}

/**
 * Runs the same steps again.
 *
 * The point of a history is comparing like with like, so a re-run repeats the
 * step list of the run it was started from rather than defaulting to
 * everything — a full sweep compared against a metadata-only run would show
 * movement that never happened.
 */
export async function rerunAction(formData: FormData) {
  const runId = Number(formData.get('runId'))
  if (!Number.isInteger(runId)) return

  const previous = previousRunSpec(runId)
  if (!previous) return

  let newRunId: number
  try {
    newRunId = startRun(previous.clientId, previous.stepKeys, {}, `re-run of #${runId}`)
  } catch {
    // Almost always "this client already has a run in progress", which the
    // runs page states plainly — better than a thrown error on a form post.
    redirect('/runs')
  }

  revalidatePath('/', 'layout')
  redirect(`/runs/${newRunId}`)
}


/**
 * Starts the same run for several clients in one press.
 *
 * They genuinely go at once — the runner works up to its parallel limit
 * simultaneously and queues the rest — with the one exception it cannot avoid:
 * asking the AI engines needs the single signed-in browser, so those steps take
 * turns. A batch of five reads five websites at the same time and then measures
 * them one after another, which is still far less waiting than five runs
 * started by hand, each watched to the end before the next is begun.
 *
 * A client that already has a run going is refused by name rather than quietly
 * dropped: an operator who ticked ten boxes has to know which nine went.
 */
export async function startRunsAction(
  _prev: BatchFormState,
  formData: FormData,
): Promise<BatchFormState> {
  const clientIds = formData
    .getAll('clientIds')
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0)

  if (clientIds.length === 0) return { error: 'Pick at least one client.', refused: [] }

  const steps = stepsFrom(formData)
  if (steps.length === 0) return { error: 'Pick at least one step to run.', refused: [] }

  const opts = optionsFrom(formData)
  const label = String(formData.get('label') ?? '').trim()

  /** Sent alongside the ids so a refusal can name the business, not a number. */
  const names = new Map(
    formData
      .getAll('clientNames')
      .map(String)
      .map((entry) => {
        const [id, ...rest] = entry.split(':')
        return [Number(id), rest.join(':')] as const
      }),
  )

  const refused: { name: string; reason: string }[] = []
  let started = 0

  for (const clientId of clientIds) {
    try {
      startRun(clientId, steps, opts, label)
      started += 1
    } catch (err) {
      refused.push({
        name: names.get(clientId) ?? `client #${clientId}`,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  revalidatePath('/', 'layout')

  // Nothing started: stay here and say why, rather than sending the operator to
  // a runs page that looks unchanged for no stated reason.
  if (started === 0) return { error: 'None of these clients could be started.', refused }

  // Some went and some did not: the page worth being on is the one naming the
  // ones that did not, so it is shown before going anywhere.
  if (refused.length > 0) return { error: null, refused }

  redirect('/runs')
}
