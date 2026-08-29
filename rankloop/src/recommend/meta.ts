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

export function recommendMeta(input: RecommendInput): Recommendation[] {
  const { client, locations, pages } = input
  const out: Recommendation[] = []

  for (const page of pages) {
    const currentTitle = page.title.trim()
    const currentDesc = page.metaDescription.trim()

    // ── title
    const proposedTitle = buildTitle(page, client, locations)
    if (proposedTitle && proposedTitle.toLowerCase() !== currentTitle.toLowerCase()) {
      const problems: string[] = []
      if (!currentTitle) problems.push('the page has no title')
      else if (currentTitle.length > TITLE_MAX) problems.push(`the title is ${currentTitle.length} characters, so search engines cut it off`)
      if (SUPERLATIVE_PATTERN.test(currentTitle)) {
        problems.push('it leads with a superlative, which the research measures as neutral-to-negative')
      }
      SUPERLATIVE_PATTERN.lastIndex = 0
      if (locationFor(page, locations) && !locations.some((l) => currentTitle.toLowerCase().includes(l.name.toLowerCase()))) {
        problems.push('the page is about a place it never names in the title')
      }

      if (problems.length > 0) {
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
    }

    // ── description
    const proposedDesc = buildDescription(page, client, locations)
    if (proposedDesc) {
      const problems: string[] = []
      if (!currentDesc) problems.push('the page has no meta description, so engines invent one from the copy')
      else if (currentDesc.length > DESC_MAX) problems.push(`it is ${currentDesc.length} characters and gets truncated`)
      else if (currentDesc.length < 70) problems.push(`it is only ${currentDesc.length} characters, which wastes the space`)

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
