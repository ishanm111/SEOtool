import { labelsByKey, optionsByKey } from './client-questionnaire'

/**
 * Reading a client's Google Form answers back into the questionnaire.
 *
 * The form goes out, the client fills it in, and the answers land in a Google
 * Sheet — which is where the Google route has always quietly ended, because
 * getting them from there into the tool meant retyping fourteen answers by
 * hand. This takes whatever an operator copied out of that sheet and puts each
 * answer against the question it belongs to.
 *
 * Nothing here writes anything. It returns what it would do, and the operator
 * confirms it, because the one unrecoverable mistake available is overwriting a
 * good answer with a mis-matched one.
 *
 * Three shapes are accepted, because there are three obvious ways to copy a
 * response out of Google and no operator should have to know which one the tool
 * wanted:
 *
 *   1. A sheet's header row and its response rows, tabbed.
 *   2. One question and its answer per line, tabbed — a transposed sheet.
 *   3. The question on one line and the answer under it, as the form's own
 *      "individual response" view prints it.
 *
 * The third is read by looking for the questions rather than counting lines: a
 * line that matches a known question starts a new answer and everything under
 * it belongs to that one. Blank lines, wrapped paragraphs and whatever else
 * came along in the copy then cost nothing.
 */

export type MatchQuality = 'exact' | 'close' | 'none'

export type ParsedAnswer = {
  /** The question as it was pasted, so an operator can see what was read. */
  heading: string
  value: string
  key: string | null
  quality: MatchQuality
  /** What is on file for that key right now. */
  current: string
  action: 'new' | 'change' | 'same' | 'unmatched'
}

/** Columns every Google Sheet of responses carries and no question maps to. */
const IGNORED = new Set(['timestamp', 'email address', 'score', 'username'])

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    // Forms marks a required question with an asterisk, and a pasted heading
    // often keeps it.
    .replace(/\s*\*\s*$/, '')
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(text: string): Set<string> {
  // Short words carry no signal and two questions can share every one of them.
  return new Set(normalise(text).split(' ').filter((w) => w.length > 2))
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared += 1
  return shared / Math.max(a.size, b.size)
}

type Index = {
  exact: Map<string, string>
  fuzzy: { key: string; tokens: Set<string> }[]
}

function buildIndex(): Index {
  const labels = labelsByKey()
  const exact = new Map<string, string>()
  const fuzzy: { key: string; tokens: Set<string> }[] = []

  for (const [key, variants] of Object.entries(labels)) {
    for (const label of variants) {
      exact.set(normalise(label), key)
      fuzzy.push({ key, tokens: tokens(label) })
    }
  }

  return { exact, fuzzy }
}

/** How much of a heading must match a known question before it counts. */
const CLOSE_ENOUGH = 0.6

function matchHeading(heading: string, index: Index): { key: string | null; quality: MatchQuality } {
  const norm = normalise(heading)
  if (!norm || IGNORED.has(norm)) return { key: null, quality: 'none' }

  const hit = index.exact.get(norm)
  if (hit) return { key: hit, quality: 'exact' }

  const asked = tokens(heading)
  let best: { key: string; score: number } | null = null
  for (const candidate of index.fuzzy) {
    const score = overlap(asked, candidate.tokens)
    if (!best || score > best.score) best = { key: candidate.key, score }
  }

  if (best && best.score >= CLOSE_ENOUGH) return { key: best.key, quality: 'close' }
  return { key: null, quality: 'none' }
}

/** A choice answer arrives as the option's label; the tool stores its value. */
function toStoredValue(key: string, value: string): string {
  const options = optionsByKey()[key]
  if (!options) return value
  const norm = normalise(value)
  const hit = options.find((o) => normalise(o.label) === norm || normalise(o.value) === norm)
  return hit ? hit.value : value
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

/**
 * Shape 1: a sheet's header row and its response rows, tabbed.
 *
 * More than one response row is the normal case — an operator selects the whole
 * sheet, not one row of it — and the newest is the one that matters, so the last
 * row wins and the count is reported rather than the extras being dropped in
 * silence.
 */
function fromSheet(
  lines: string[],
  index: Index,
): { pairs: { heading: string; value: string }[]; rows: number } | null {
  const rows = lines.filter((l) => l.trim())
  if (rows.length < 2) return null

  const headings = rows[0].split('\t')
  if (headings.length < 2) return null

  // A header row is a row where several cells are questions. Without this a
  // transposed sheet — question in column A, answer in column B — would be read
  // as one very wide response.
  const known = headings.filter((h) => matchHeading(h, index).key).length
  if (known < 2) return null

  const data = rows.slice(1).filter((r) => r.split('\t').length === headings.length)
  if (data.length === 0) return null

  const values = data[data.length - 1].split('\t')
  return {
    pairs: headings.map((heading, i) => ({ heading, value: values[i] ?? '' })),
    rows: data.length,
  }
}

/** Shape 2: one `question<TAB>answer` per line. */
function fromTabbedPairs(lines: string[]): { heading: string; value: string }[] | null {
  const rows = lines.filter((l) => l.trim())
  if (rows.length < 2) return null
  const tabbed = rows.filter((l) => l.includes('\t'))
  if (tabbed.length < rows.length / 2) return null
  return tabbed.map((row) => {
    const at = row.indexOf('\t')
    return { heading: row.slice(0, at), value: row.slice(at + 1).replace(/\t/g, ' ').trim() }
  })
}

/**
 * Shape 3: a question on its own line, its answer on the lines below.
 *
 * Driven by the questions rather than by line counting, so a wrapped answer, a
 * blank line or a stray section heading does not shift everything after it by
 * one.
 */
function fromProse(lines: string[], index: Index): { heading: string; value: string }[] {
  const out: { heading: string; value: string }[] = []
  let current: { heading: string; value: string[] } | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const { key } = matchHeading(line, index)
    if (key) {
      if (current) out.push({ heading: current.heading, value: current.value.join('\n').trim() })
      current = { heading: line, value: [] }
      continue
    }

    if (current) current.value.push(line)
  }

  if (current) out.push({ heading: current.heading, value: current.value.join('\n').trim() })
  return out
}

/**
 * What a paste would change, question by question. Writes nothing.
 *
 * `facts` is what is on file, so the result can say which answers are new,
 * which would overwrite something, and which are already what the tool has —
 * the three being very different decisions for whoever presses the button.
 */
export function parseAnswers(
  pasted: string,
  facts: Record<string, string>,
): { rows: ParsedAnswer[]; responses: number } {
  const index = buildIndex()
  const lines = splitLines(pasted)

  const sheet = fromSheet(lines, index)
  const pairs = sheet?.pairs ?? fromTabbedPairs(lines) ?? fromProse(lines, index)

  const seen = new Set<string>()
  const out: ParsedAnswer[] = []

  for (const pair of pairs) {
    const heading = pair.heading.trim()
    const raw = pair.value.trim()
    if (!heading) continue

    const { key, quality } = matchHeading(heading, index)

    if (!key) {
      // A column every sheet carries is not worth reporting as a failure.
      if (IGNORED.has(normalise(heading))) continue
      out.push({ heading, value: raw, key: null, quality: 'none', current: '', action: 'unmatched' })
      continue
    }

    // Two headings matching one key would otherwise both be written, with the
    // later one silently winning.
    if (seen.has(key)) continue
    seen.add(key)

    const value = toStoredValue(key, raw)
    const current = facts[key] ?? ''
    const action = !value ? 'same' : current === value ? 'same' : current ? 'change' : 'new'

    out.push({ heading, value, key, quality, current, action })
  }

  return { rows: out, responses: sheet?.rows ?? 1 }
}

/** The answers to write, as `saveFacts` takes them. */
export function answersToSave(parsed: ParsedAnswer[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of parsed) {
    if (!row.key || row.action === 'same' || row.action === 'unmatched') continue
    out[row.key] = row.value
  }
  return out
}
