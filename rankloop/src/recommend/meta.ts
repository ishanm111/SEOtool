import type { Recommendation, RecommendInput, PageRow } from './types'
import { FILL, SUPERLATIVE_PATTERN } from './types'
import type { Client, ClientLocation } from '../lib/client'

/**
 * Rewrites titles and meta descriptions.
 *
 * The lowest-risk change available: nothing visible on the page moves, yet the
 * title is the strongest single on-page signal and the description is what an
 * engine quotes when it summarises the page.
 */

const TITLE_MAX = 60
const DESC_MAX = 155

/** Which location, if any, this page is about. */
function locationFor(page: PageRow, locations: ClientLocation[]): ClientLocation | null {
  const haystack = `${page.slug} ${page.title}`.toLowerCase()
  return (
    locations.find((l) => {
      const n = l.name.toLowerCase()
      return haystack.includes(n) || haystack.includes(n.replace(/\s+/g, '-'))
    }) ?? null
  )
}

/** The offering this page is about, matched against the client's own list. */
function offeringFor(page: PageRow, client: Client): string | null {
  const haystack = `${page.slug} ${page.title}`.toLowerCase()
  const matches = client.offerings
    .filter((o) => {
      const words = o.split(/\s+/).filter((w) => w.length > 3)
      return words.length > 0 && words.every((w) => haystack.includes(w))
    })
    .sort((a, b) => b.length - a.length)
  return matches[0] ?? null
}

function titleCase(s: string): string {
  const small = new Set(['a', 'an', 'the', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of'])
  return s
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/**
 * Shortens a title by dropping whole segments rather than cutting mid-phrase.
 *
 * A hard character cut leaves things like "Cruiser Slip On - Sea Spray (Natural
 * White" — an unclosed bracket and a dangling word, which is worse than the
 * overlong title it replaced. Product names carry their least important
 * information last (colourway, sole, variant), so removing trailing segments
 * shortens them while keeping them readable.
 */
function shorten(s: string, max: number): string {
  let out = s.trim()
  if (out.length <= max) return out

  // Trailing parenthetical is almost always a variant detail.
  const withoutParens = out.replace(/\s*\([^)]*\)\s*$/, '').trim()
  if (withoutParens.length >= 15 && withoutParens.length < out.length) out = withoutParens
  if (out.length <= max) return out

  // Then trailing " - colourway" style segments, one at a time.
  while (out.length > max) {
    const cut = out.replace(/\s*[-–—]\s*[^-–—]+$/, '').trim()
    if (cut.length < 15 || cut === out) break
    out = cut
  }
  if (out.length <= max) return out

  // Only now fall back to a word-boundary cut.
  const hard = out.slice(0, max)
  const lastSpace = hard.lastIndexOf(' ')
  const cut = (lastSpace > max * 0.6 ? hard.slice(0, lastSpace) : hard).replace(/[,;:\-–—(\s]+$/, '')

  /**
   * Never leave half a placeholder behind. A cut that lands inside "[[FILL: …]]"
   * produces text that no longer reads as a placeholder, so it stops looking
   * like something a human still has to fill in — which is the one thing the
   * marker exists to guarantee. Drop the whole placeholder instead.
   */
  return cut.includes('[[FILL:') && !cut.trimEnd().endsWith(']]')
    ? cut.slice(0, cut.lastIndexOf('[[FILL:')).replace(/[,;:\-–—(\s]+$/, '')
    : cut
}

/**
 * Builds a title from what the page is actually about, plus the business name.
 * Deliberately formulaic — a title is a label, not prose, and the pattern
 * "<what> in <where> | <who>" is what both people and engines expect.
 */
function buildTitle(page: PageRow, client: Client, locations: ClientLocation[]): string | null {
  const loc = locationFor(page, locations)
  const offering = offeringFor(page, client)
  const isEcom = client.businessType === 'ecommerce'

  let subject: string
  if (isEcom) {
    // A product or collection already has a good name — its own title.
    subject = page.title.split(/[|–—]/)[0].trim() || titleCase(page.slug.replace(/[-_]/g, ' '))
  } else if (offering && loc) {
    subject = `${titleCase(offering)} in ${loc.name}${loc.region ? `, ${loc.region}` : ''}`
  } else if (loc) {
    subject = `${titleCase(client.offerings[0] ?? 'Services')} in ${loc.name}`
  } else if (offering) {
    subject = titleCase(offering)
  } else {
    return null
  }

  const withBrand = `${subject} | ${client.name}`
  return shorten(withBrand.length <= TITLE_MAX ? withBrand : subject, TITLE_MAX)
}

/**
 * A description is a one-line answer, not a keyword list. The engines quote it,
 * so it reads as a sentence and leads with what the business does.
 */
function buildDescription(page: PageRow, client: Client, locations: ClientLocation[]): string | null {
  const loc = locationFor(page, locations)
  const offering = offeringFor(page, client)
  const isEcom = client.businessType === 'ecommerce'

  // Reuse the page's own opening if it already answers directly.
  const firstSentence = page.text.split(/(?<=[.!?])\s/).find((s) => s.trim().length > 40)?.trim()

  let body: string
  if (isEcom) {
    const subject = page.title.split(/[|–—]/)[0].trim() || page.slug.replace(/[-_]/g, ' ')
    /**
     * The fallback used to promise "Free delivery and returns on every order",
     * which is both a guess about the store and an invented claim — exactly what
     * the rest of this codebase refuses to do. A meta description is published
     * text, so it gets a placeholder like everything else.
     */
    body = firstSentence
      ? `${firstSentence}`
      : `${titleCase(subject)} from ${client.name}. ${FILL('one line on why this is worth buying')}`
  } else if (offering && loc) {
    // "Book a technician" assumes a repair trade. Plenty of local businesses
    // send nobody, or send someone who is not called a technician.
    body = `${titleCase(offering)} across ${loc.name}${loc.region ? `, ${loc.region}` : ''}. ${
      client.primaryPhone ? `Call ${client.primaryPhone} to book.` : 'Call to book.'
    }`
  } else if (loc) {
    body = `${client.name} covers ${loc.name}${loc.region ? `, ${loc.region}` : ''}. ${
      client.primaryPhone ? `Call ${client.primaryPhone}.` : ''
    }`
  } else if (firstSentence) {
    body = firstSentence
  } else {
    return null
  }

  return shorten(body.replace(/\s+/g, ' ').trim(), DESC_MAX)
}


/**
 * The words that say what this page is about: what the business sells, and where.
 *
 * Used to compare a rewrite against what it would replace. A title can be too
 * long, or carry a superlative, and still be the only place on the page that
 * names the thing being sold — swapping it for a shorter, blander line fixes the
 * measured fault and loses the meaning, which is a worse page by the standard
 * this whole tool is built on.
 */
function subjectTerms(client: Client, locations: ClientLocation[]): string[] {
  const terms = new Set<string>()
  for (const o of client.offerings) {
    for (const w of o.split(/\s+/)) if (w.length > 3) terms.add(w.toLowerCase())
  }
  for (const l of locations) terms.add(l.name.toLowerCase())
  return [...terms]
}

/** How many distinct subject terms a piece of text actually carries. */
function informationScore(text: string, terms: string[]): number {
  const lower = text.toLowerCase()
  return terms.filter((t) => lower.includes(t)).length
}

/**
 * The same text with its superlatives removed, or null when that cannot be done
 * cleanly. Preferred over a generated replacement when the only fault is puff:
 * the business wrote the rest of the line, and it is about something real.
 */
function withoutSuperlatives(text: string): string | null {
  SUPERLATIVE_PATTERN.lastIndex = 0
  const stripped = text
    .replace(SUPERLATIVE_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    // Separators left stranded by the removal.
    .replace(/\s*([|–—-])\s*\1+/g, ' $1 ')
    .replace(/^\s*[|–—-]\s*/, '')
    .replace(/\s*[|–—-]\s*$/, '')
    .replace(/\s+([,.])/g, '$1')
    .trim()
  SUPERLATIVE_PATTERN.lastIndex = 0
  return stripped.length >= 15 && stripped !== text.trim() ? stripped : null
}

/**
 * Trims a description without dismantling it.
 *
 * `shorten` drops trailing dash-separated segments, which is right for a product
 * title and wrong for a sentence: a description that reads "El Barrilito Liquor
 * Store in Pasadena, TX — tequila, mezcal, whiskey…" loses everything it was
 * about at the first em dash. Whole sentences are kept instead, and only a
 * single over-long sentence falls back to a word-boundary cut.
 */
function shortenProse(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean

  const sentences = clean.split(/(?<=[.!?])\s+/)
  let out = ''
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence
    if (next.length > max) break
    out = next
  }
  if (out.length >= 60) return out

  const hard = clean.slice(0, max)
  const lastBreak = Math.max(hard.lastIndexOf(', '), hard.lastIndexOf(' '))
  return (lastBreak > max * 0.6 ? hard.slice(0, lastBreak) : hard).replace(/[,;:\-–—(\s]+$/, '')
}

/**
 * Which text to actually propose.
 *
 * A generated line only wins when it says at least as much about the page as the
 * one already there. Otherwise the existing text is repaired in place — trimmed
 * to length, stripped of puff — and if neither is needed, nothing is proposed at
 * all, because a rewrite that changes nothing real is noise in a client's list.
 */
function bestProposal(input: {
  current: string
  generated: string | null
  max: number
  terms: string[]
  dropSuperlatives: boolean
  /** How this kind of text is shortened: a title is a label, a description is prose. */
  trim: (text: string, max: number) => string
}): string | null {
  const { current, generated, max, terms, dropSuperlatives, trim } = input
  if (!current) return generated

  let repaired = current
  if (dropSuperlatives) repaired = withoutSuperlatives(repaired) ?? repaired
  if (repaired.length > max) repaired = trim(repaired, max)

  /**
   * Strictly better, not merely equal. On a tie the business's own words win:
   * they were written by someone who knows the business, and a generated line
   * that says the same amount is a change for its own sake.
   */
  const generatedWins =
    generated !== null && informationScore(generated, terms) > informationScore(repaired, terms)
  const choice = generatedWins ? generated : repaired
  return choice.trim() && choice.trim().toLowerCase() !== current.trim().toLowerCase() ? choice.trim() : null
}

export function recommendMeta(input: RecommendInput): Recommendation[] {
  const { client, locations, pages } = input
  const out: Recommendation[] = []
  const terms = subjectTerms(client, locations)

  for (const page of pages) {
    const currentTitle = page.title.trim()
    const currentDesc = page.metaDescription.trim()

    // ── title
    const problems: string[] = []
    if (!currentTitle) problems.push('the page has no title')
    else if (currentTitle.length > TITLE_MAX) problems.push(`the title is ${currentTitle.length} characters, so search engines cut it off`)
    SUPERLATIVE_PATTERN.lastIndex = 0
    const puffyTitle = SUPERLATIVE_PATTERN.test(currentTitle)
    SUPERLATIVE_PATTERN.lastIndex = 0
    if (puffyTitle) {
      problems.push('it leads with a superlative, which the research measures as neutral-to-negative')
    }
    if (locationFor(page, locations) && !locations.some((l) => currentTitle.toLowerCase().includes(l.name.toLowerCase()))) {
      problems.push('the page is about a place it never names in the title')
    }

    const proposedTitle = bestProposal({
      current: currentTitle,
      generated: buildTitle(page, client, locations),
      max: TITLE_MAX,
      terms,
      dropSuperlatives: puffyTitle,
      trim: shorten,
    })

    if (proposedTitle && problems.length > 0) {
      out.push({
        pageId: page.id,
        kind: 'meta_title',
        target: page.url,
        currentValue: currentTitle || null,
        proposedValue: proposedTitle,
        reason: `Rewrite because ${problems.join('; and ')}.`,
        priority: problems.length > 1 ? 78 : 68,
      })
    }

    // ── description
    SUPERLATIVE_PATTERN.lastIndex = 0
    const puffyDesc = SUPERLATIVE_PATTERN.test(currentDesc)
    SUPERLATIVE_PATTERN.lastIndex = 0
    const proposedDesc = bestProposal({
      current: currentDesc,
      generated: buildDescription(page, client, locations),
      max: DESC_MAX,
      terms,
      dropSuperlatives: puffyDesc,
      trim: shortenProse,
    })
    if (proposedDesc) {
      const problems: string[] = []
      if (!currentDesc) problems.push('the page has no meta description, so engines invent one from the copy')
      else if (currentDesc.length > DESC_MAX) problems.push(`it is ${currentDesc.length} characters and gets truncated`)
      else if (currentDesc.length < 70) problems.push(`it is only ${currentDesc.length} characters, which wastes the space`)
      if (puffyDesc) problems.push('it uses superlatives, which the research measures as neutral-to-negative')

      if (problems.length > 0 && proposedDesc.toLowerCase() !== currentDesc.toLowerCase()) {
        out.push({
          pageId: page.id,
          kind: 'meta_description',
          target: page.url,
          currentValue: currentDesc || null,
          proposedValue: proposedDesc,
          reason: `Rewrite because ${problems.join('; and ')}.`,
          priority: currentDesc ? 60 : 72,
        })
      }
    }
  }

  return out
}
