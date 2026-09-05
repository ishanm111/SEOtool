/**
 * The stages of one press of "Start a new run", in the order they must happen.
 *
 * Each stage is an existing script rather than a re-implementation of it. The
 * command line stays the supported way to work — the console drives the same
 * binaries an operator would type, so the two can never drift into disagreeing
 * about what a run does.
 *
 * Order is a real dependency chain, not a preference: nothing can be analysed
 * before the site is read and the engines asked, and the report is a rendering
 * of what analysis found.
 */

export type StepKey =
  | 'ingest'
  | 'prompts'
  | 'measure'
  | 'competitors'
  | 'analyze'
  | 'recommend'
  | 'report'

export type StepDef = {
  key: StepKey
  /** What this does, in the words used with a client rather than in code. */
  label: string
  description: string
  script: string
  /** Roughly how long, so a run that takes an hour never looks like a hang. */
  duration: string
  /**
   * Drives a real browser against the consumer chat apps, so it needs a signed-in
   * profile and cannot be hurried. Flagged because it is the one step that can
   * fail for a reason outside the tool.
   */
  usesBrowser?: boolean
}

export const PIPELINE: StepDef[] = [
  {
    key: 'ingest',
    label: 'Read the website',
    description: 'Pulls every page, splits it into paragraphs and scores each one.',
    script: 'src/scripts/ingest.ts',
    duration: 'about a minute',
  },
  {
    key: 'prompts',
    label: 'Write the question set',
    description: 'Builds the questions a real customer would ask, per service and place.',
    script: 'src/scripts/generate-prompts.ts',
    duration: 'seconds',
  },
  {
    key: 'measure',
    label: 'Ask the AI engines',
    description: 'Puts each question to the chat engines and screenshots the answer.',
    script: 'src/scripts/measure.ts',
    duration: '20–90 minutes',
    usesBrowser: true,
  },
  {
    key: 'competitors',
    label: 'Profile the competitors',
    description: 'Crawls every business the engines named and measures it on the same scale.',
    script: 'src/scripts/mine-competitors.ts',
    duration: '2–10 minutes',
  },
  {
    key: 'analyze',
    label: 'Work out what is wrong',
    description: 'Turns the answers and the crawl into ranked findings.',
    script: 'src/scripts/analyze.ts',
    duration: 'seconds',
  },
  {
    key: 'recommend',
    label: 'Build the fix list',
    description: 'Writes the exact titles, copy, schema and new pages to publish.',
    script: 'src/scripts/recommend.ts',
    duration: 'seconds',
  },
  {
    key: 'report',
    label: 'Generate the client report',
    description: 'Renders the single HTML document that gets sent to the client.',
    script: 'src/scripts/report.ts',
    duration: 'seconds',
  },
]

export const STEP_BY_KEY = new Map(PIPELINE.map((s) => [s.key, s]))

export const ALL_STEP_KEYS = PIPELINE.map((s) => s.key)

/**
 * A sweep that skips the engines.
 *
 * Asking the engines is the slow, fragile part and the only one that needs a
 * signed-in browser. Everything else re-runs against answers already collected,
 * which is what an operator wants after editing a client's service area or
 * re-crawling their site.
 */
export const DESK_STEP_KEYS: StepKey[] = ['ingest', 'competitors', 'analyze', 'recommend', 'report']

export const RUN_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/**
 * `waiting` is not `pending`: the steps before it are finished and it is ready
 * to go, but something outside this run is holding the one resource it needs —
 * in practice the signed-in browser, which only one client can drive at a time.
 */
export type StepStatus = 'pending' | 'waiting' | 'running' | 'done' | 'failed' | 'skipped'

export const isFinished = (status: string) =>
  status === 'done' || status === 'failed' || status === 'cancelled'

/** Parses the JSON column, never throwing — a bad row must not take a page down. */
export function parseStepKeys(raw: string): StepKey[] {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((k): k is StepKey => STEP_BY_KEY.has(k as StepKey))
  } catch {
    return []
  }
}
