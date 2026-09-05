import { isPlaceBasedClient, type Client } from '../lib/client'
import { MIN_ANSWER_CHARS } from '../config'

/**
 * Pulls business names out of an AI answer.
 *
 * There is no clean way to do this — the engines write prose, not JSON. But they
 * are extremely consistent about *formatting* recommendations: bold, headings,
 * or numbered lists. That formatting is the signal we lean on, backed up by a
 * plausibility check so we do not collect every capitalised phrase in the answer.
 */

/** Words that mark a name as a company, in any industry. */
const GENERIC_BUSINESS_WORDS = [
  'service', 'services', 'company', 'co', 'llc', 'inc', 'ltd', 'corp', 'group',
  'solutions', 'shop', 'store', 'supply', 'supplies', 'pros', 'experts',
  'specialists', 'works', 'brothers', 'bros', 'sons', 'partners', 'associates',
  'brands', 'goods', 'collective', 'studio', 'labs', 'depot', 'outlet', 'market',
]

/** Openers that mean the line is prose, not a business name. */
const NOT_A_NAME = [
  'the', 'this', 'that', 'these', 'those', 'here', 'there', 'if', 'when', 'while',
  'for', 'and', 'but', 'you', 'your', 'they', 'their', 'it', 'its', 'we', 'our',
  'a', 'an', 'in', 'on', 'at', 'to', 'from', 'with', 'about', 'note', 'tip',
  'important', 'why', 'how', 'what', 'best', 'top', 'other', 'also', 'based',
  'consider', 'check', 'call', 'ask', 'look', 'make', 'be', 'always', 'before',
  'summary', 'options', 'recommendation', 'recommendations', 'disclaimer',
  'pros', 'cons', 'price', 'cost', 'features', 'overall', 'verdict',
]

/**
 * Industry vocabulary, taken from the client rather than a fixed list. A repair
 * business contributes "repair"; a toy store contributes "toys".
 *
 * The business's own NAME is included as well as its offerings. A repair company
 * may list services as "refrigerator repair, freezer repair" and never use the
 * word "appliance" — yet "Appliance" is exactly the word its competitors put in
 * their names. Taking it from the name catches that.
 */
function industryWords(client: Client): string[] {
  const words = new Set<string>()
  const sources = [...client.offerings, client.name]
  for (const source of sources) {
    for (const w of source.toLowerCase().split(/[^a-z]+/)) {
      if (w.length >= 4) words.add(w)
    }
  }
  return [...words]
}

/**
 * Business names listed in an embedded map panel, which the engines render as
 * alternating rating and name lines:
 *
 *   4.9
 *   Some Business Name
 *   5.0
 *   Another Business
 *
 * These are the local map pack — the single most useful thing in the answer,
 * since it names the businesses actually ranking. They carry no markdown, so the
 * structural pattern is the only way to reach them, and it is strong enough that
 * no vocabulary check is needed.
 */
function mapPanelNames(answerText: string): string[] {
  const lines = answerText.split('\n').map((l) => l.trim())
  const out: string[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^[0-5]\.\d$/.test(lines[i])) continue
    const candidate = lines[i + 1]
    if (candidate.length < 4 || candidate.length > 70) continue
    if (!/^[A-Z]/.test(candidate)) continue
    if (/\b(closed|opens?|hours|reviews?|expand|terms)\b/i.test(candidate)) continue
    out.push(candidate)
  }
  return out
}

function looksLikeBusinessName(raw: string, vocabulary: string[], requireVocabulary: boolean): boolean {
  const name = raw.trim().replace(/[.,;:!?]+$/, '')
  if (name.length < 4 || name.length > 70) return false

  const words = name.split(/\s+/)
  if (words.length < 2 || words.length > 7) return false

  const first = words[0].toLowerCase().replace(/[^a-z]/g, '')
  if (NOT_A_NAME.includes(first)) return false

  // Map-widget debris: embedded maps leak status labels, star ratings, category
  // labels and attribution text, which concatenate onto real names. These words
  // appear mid-string as often as at the start, so match anywhere.
  if (/\b(closed|opens?|hours|reviews?)\b/i.test(name)) return false
  if (/^[a-z]/.test(name)) return false
  if (/\b(openstreetmap|google maps|mapbox)\b/i.test(name)) return false
  if (/\b\d\.\d\b/.test(name)) return false

  // Sentence bleed: "Richmond. Richmond Appliance" is two sentences glued
  // together. But an abbreviation is legitimate inside a name — "Mr. E Appliance
  // Service", "St. Louis Repair" — so only reject when the token before the full
  // stop is long enough to be a real word rather than a title.
  const sentenceBreak = name.match(/(\w+)\.\s+[A-Z]/)
  if (sentenceBreak && sentenceBreak[1].length > 3) return false

  // Must read like a proper noun: most words capitalised or all-caps.
  const capitalised = words.filter((w) => /^[A-Z0-9&''-]/.test(w)).length
  if (capitalised / words.length < 0.6) return false

  if (!requireVocabulary) return true

  const lower = name.toLowerCase()
  return vocabulary.some((w) => new RegExp(`\\b${w}\\b`).test(lower))
}

export function isClientName(name: string, client: Client): boolean {
  const lower = name.toLowerCase()
  return client.aliases.some((a) => lower.includes(a))
}

/**
 * Whether a run counts as an AI answer.
 *
 * Three call sites had their own copy of `ok && answerText.trim()`, and all
 * three disagreed with the measurement run about what an answer is. A Google ask
 * is recorded as successful when it returns organic results, whether or not
 * Google showed an AI Overview — so an empty answer was dropped from the
 * denominator in one place and counted as a successful ask in another, and a
 * scrap of page furniture short enough to be meaningless was counted as a full
 * answer the client was absent from.
 *
 * Absent is not the same as measured-and-not-mentioned. This is the single place
 * that decides which one a row is.
 */
export function isAnswer(run: { ok: boolean; answerText: string }): boolean {
  return run.ok && run.answerText.trim().length >= MIN_ANSWER_CHARS
}

export function mentionsClient(text: string, client: Client): boolean {
  const lower = text.toLowerCase()
  if (client.aliases.some((a) => lower.includes(a))) return true
  // Phone numbers are a reliable secondary signal — punctuation varies, digits don't.
  const digits = text.replace(/\D/g, '')
  return client.phones.some((p) => {
    const d = p.replace(/\D/g, '')
    return d.length >= 10 && digits.includes(d)
  })
}

export type ParsedMention = {
  businessName: string
  isClient: boolean
  position: number
  snippet: string
}

export function extractMentions(answerText: string, client: Client): ParsedMention[] {
  if (!answerText.trim()) return []

  const vocabulary = [...GENERIC_BUSINESS_WORDS, ...industryWords(client)]
  /**
   * A business people go to almost always carries a trade word in its name, so
   * demanding one keeps the noise down. Online stores are frequently pure brand
   * names ("Nomad", "Ridge"), so requiring vocabulary there would miss most of
   * them — the markdown formatting is relied on instead.
   */
  const requireVocabulary = isPlaceBasedClient(client)

  // Names from the embedded map panel are structurally certain, so they skip the
  // vocabulary check that the looser patterns below need.
  const certain = new Set(mapPanelNames(answerText))
  const candidates: string[] = [...certain]

  // 1. Markdown emphasis and headings — how every engine formats a recommendation.
  for (const m of answerText.matchAll(/\*\*([^*\n]{4,70})\*\*/g)) candidates.push(m[1])
  for (const m of answerText.matchAll(/^#{1,4}\s+(.{4,70})$/gm)) candidates.push(m[1])

  // 2. List items: "1. Name — ...", "- Name: ...", "* Name"
  for (const m of answerText.matchAll(/^\s*(?:\d+[.)]|[-*•])\s+([^\n:—–-]{4,70})/gm)) {
    candidates.push(m[1])
  }

  // 3. Plain-prose fallback, built from the client's own industry vocabulary.
  if (vocabulary.length > 0) {
    // Capitalised, because the match is case-sensitive: a trade word inside a
    // name is capitalised ("Clearwater Appliance Repair"), the same word in prose
    // is not ("...offers appliance repair nearby").
    const trailing = vocabulary
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('|')
    // Deliberately case-SENSITIVE, and the trailing trade word must be
    // capitalised too. "Clearwater Appliance Repair" is a name; "...offers
    // appliance repair in the area" is prose, and matching the latter produces
    // fragments that then block the real name during de-duplication.
    const re = new RegExp(
      `\\b([A-Z][\\w&''.-]*(?:\\s+[A-Z0-9][\\w&''.-]*){1,5}\\s+(?:${trailing}))\\b`,
      'g',
    )
    for (const m of answerText.matchAll(re)) candidates.push(m[1])
  }

  const seen = new Map<string, ParsedMention>()
  let position = 0

  for (const raw of candidates) {
    const name = raw.trim().replace(/[.,;:!?]+$/, '').replace(/\s+/g, ' ')
    const needsVocabulary = requireVocabulary && !certain.has(raw)
    if (!looksLikeBusinessName(name, vocabulary, needsVocabulary)) continue

    const key = name.toLowerCase()
    if (seen.has(key)) continue

    const idx = answerText.indexOf(name)
    position++
    seen.set(key, {
      businessName: name,
      isClient: isClientName(name, client),
      position,
      snippet:
        idx >= 0
          ? answerText.slice(Math.max(0, idx - 60), idx + name.length + 120).replace(/\s+/g, ' ').trim()
          : '',
    })
  }

  // The client can be named in prose without list formatting — never miss it.
  const found = [...seen.values()]
  if (!found.some((m) => m.isClient) && mentionsClient(answerText, client)) {
    const idx = client.aliases
      .map((a) => answerText.toLowerCase().indexOf(a))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0]
    found.push({
      businessName: client.name,
      isClient: true,
      position: found.length + 1,
      snippet:
        idx >= 0
          ? answerText.slice(Math.max(0, idx - 60), idx + 180).replace(/\s+/g, ' ').trim()
          : '',
    })
  }

  return found
}
