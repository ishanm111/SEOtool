import type { Recommendation, RecommendInput, PageRow } from './types'
import { FILL, SUPERLATIVE_PATTERN } from './types'
import type { Client, ClientLocation } from '../lib/client'
import { readingEase } from '../ingest/score'

/**
 * Rewrites body copy against the three measured GEO levers: add concrete
 * numbers (+40%), improve readability (+15-30%), and cut superlatives (measured
 * neutral-to-negative).
 *
 * These are transformations, not invented prose. Where a rule can genuinely
 * improve text — splitting an overlong sentence, removing an empty superlative —
 * it does. Where the improvement needs a fact only the business has, it emits a
 * placeholder instead of making something up. A rewrite that reads beautifully
 * and states a price the business does not charge is worse than no rewrite.
 */

const LONG_SENTENCE_WORDS = 24

/** Splits overlong sentences at natural joins, which is most of readability. */
function splitLongSentences(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/)
  const out: string[] = []

  for (const sentence of sentences) {
    if (sentence.split(/\s+/).length <= LONG_SENTENCE_WORDS) {
      out.push(sentence)
      continue
    }

    // Break at a conjunction that starts a genuinely independent clause.
    const parts = sentence.split(/,\s+(?=(?:and|but|so|which|while|although|however)\s+\w)/i)
    if (parts.length === 1) {
      out.push(sentence)
      continue
    }

    for (const [i, raw] of parts.entries()) {
      let part = raw.trim()
      if (i > 0) {
        // "and the team arrives" -> "The team arrives"
        part = part.replace(/^(and|but|so|which|while|although|however)\s+/i, '')
        part = part.charAt(0).toUpperCase() + part.slice(1)
      }
      if (!/[.!?]$/.test(part)) part += '.'
      out.push(part)
    }
  }

  return out.join(' ')
}

/**
 * Replaces empty superlatives with a marker for a real fact.
 * "the best appliance repair" -> "[[FILL: …]] appliance repair"
 */
function replaceSuperlatives(text: string): string {
  return text.replace(SUPERLATIVE_PATTERN, () => FILL('replace with a verifiable fact — a number, a rating, a timeframe'))
}

/** A sentence that states what the business does, for a page that never says it. */
function directAnswer(client: Client, location: ClientLocation | null): string {
  const offering = client.offerings[0] ?? 'our services'
  const where = location ? ` across ${location.name}${location.region ? `, ${location.region}` : ''}` : ''
  const phone = client.primaryPhone
    ? ` Call ${client.primaryPhone} to book.`
    : ` Call ${FILL('phone number')} to book.`

  return client.businessType === 'ecommerce'
    ? `${client.name} sells ${offering}. ${FILL('one sentence on what makes the range different — materials, sizing, guarantee')}`
    : `${client.name} provides ${offering}${where}, usually ${FILL('typical response time, e.g. "the same day"')}.${phone}`
}

function locationFor(page: PageRow, locations: ClientLocation[]): ClientLocation | null {
  const haystack = `${page.slug} ${page.title}`.toLowerCase()
  return locations.find((l) => haystack.includes(l.name.toLowerCase())) ?? null
}

export function recommendCopy(input: RecommendInput): Recommendation[] {
  const { client, locations, pages, paragraphs } = input
  const out: Recommendation[] = []
  const pageById = new Map(pages.map((p) => [p.id, p]))

  // ── paragraph-level rewrites
  const substantial = paragraphs.filter((p) => p.wordCount >= 40)

  for (const para of substantial) {
    const page = pageById.get(para.pageId)
    if (!page) continue

    let proposed = para.text
    const reasons: string[] = []
    let priority = 0

    if (para.superlativeCount > 0) {
      proposed = replaceSuperlatives(proposed)
      reasons.push(
        `${para.superlativeCount} superlative${para.superlativeCount > 1 ? 's' : ''} carry no information and measure as neutral-to-negative for AI visibility`,
      )
      priority = Math.max(priority, 64)
    }

    if (para.readability > 0 && para.readability < 50) {
      const split = splitLongSentences(proposed)
      if (split !== proposed) {
        proposed = split
        reasons.push(
          `reading ease is ${para.readability} (hard); shorter sentences measured a 15-30% visibility gain`,
        )
        priority = Math.max(priority, 70)
      }
    }

    if (para.statCount === 0 && !para.hasCitation) {
      proposed = `${proposed.replace(/\s+$/, '')} ${FILL(
        'add one concrete figure here — a count, a timeframe, a price range, a number of years',
      )}`
      reasons.push('it contains no numbers and cites no source, the single biggest measured lever (+40%)')
      priority = Math.max(priority, 80)
    }

    if (reasons.length === 0 || proposed === para.text) continue

    const gained = readingEase(proposed.replace(/\[\[FILL:[^\]]*\]\]/g, ''))
    out.push({
      pageId: page.id,
      kind: 'copy',
      target: `${page.url} — paragraph ${para.sortOrder ?? ''}`.trim(),
      currentValue: para.text,
      proposedValue: proposed,
      reason:
        `Rewrite because ${reasons.join('; and ')}.` +
        (gained > para.readability ? ` Reading ease ${para.readability} → ${gained}.` : ''),
      priority,
    })
  }

  // ── page-level: does it answer the visitor's question up front?
  for (const page of pages) {
    if (page.wordCount < 150) continue
    const opening = page.text.split(/\s+/).slice(0, 100).join(' ').toLowerCase()
    if (/\b(we|our team|call|book|buy|shop|order|schedule|provides?|sells?)\b/.test(opening)) continue

    out.push({
      pageId: page.id,
      kind: 'copy',
      target: `${page.url} — opening paragraph`,
      currentValue: page.text.split(/\s+/).slice(0, 40).join(' ') + '…',
      proposedValue: directAnswer(client, locationFor(page, locations)),
      reason:
        'The page does not say what the business does in the first 100 words. AI engines extract from the top of a page, so a slow opening rarely gets quoted.',
      priority: 74,
    })
  }

  return out
}
