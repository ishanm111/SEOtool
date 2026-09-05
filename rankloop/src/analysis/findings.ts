import { RATING_THRESHOLDS } from '../config'
import type { Client, ClientLocation } from '../lib/client'
import { hasGoogleProfile, isPlaceBasedClient, sellsProductsClient } from '../lib/client'
import { hasBusinessSchema } from '../lib/schema-types'

export type NewFinding = {
  targetType: 'site' | 'page' | 'paragraph' | 'offsite'
  targetId?: number | null
  category: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  issue: string
  currentText?: string | null
  proposedText?: string | null
  evidence?: string | null
}

type PageRow = {
  id: number
  slug: string
  url: string
  title: string
  metaDescription: string
  text: string
  wordCount: number
  /** Words the page served as HTML, before any structured-data fallback. */
  renderedWordCount?: number
  schemaTypes: string
  pageType: string
  geoRefs: string
  wrongGeoHits: number
}

type ParagraphRow = {
  id: number
  pageId: number
  heading: string
  text: string
  wordCount: number
  statCount: number
  hasCitation: boolean
  superlativeCount: number
  readability: number
}

type RunRow = { id: number; engine: string; answerText: string; ok: boolean }

type CompetitorRow = {
  domain: string
  pageCount: number
  cityPageCount: number
  faqBlockCount: number
  statsPerThousand: number
  hasLocalBusiness: boolean
  isNational: boolean
  ok: boolean
}

type BarRow = {
  businessName: string
  rating: number | null
  reviewCount: number | null
  rank: number
}

export type MarketRate = {
  label: string
  named: number
  total: number
  locations: string[]
}

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const

const list = (items: string[], max = 8) =>
  items.slice(0, max).join(', ') + (items.length > max ? `, +${items.length - max} more` : '')

/**
 * Every rule here traces to measured research, not opinion:
 *  - statistics and citations: +40% AI visibility (GEO paper, arXiv 2311.09735)
 *  - readability: +15-30%
 *  - superlatives: neutral to negative
 *
 * Nothing in this file may name a specific business, place or industry. Every
 * such value arrives through `client` or `locations`.
 */
export function buildFindings(input: {
  client: Client
  locations: ClientLocation[]
  pages: PageRow[]
  paragraphs: ParagraphRow[]
  runs: RunRow[]
  clientMentionRate: { named: number; total: number }
  /** One row per market, so a business visible in one place and invisible in another reads as two facts. */
  marketRates?: MarketRate[]
  competitors?: CompetitorRow[]
  competitiveBar?: BarRow[]
}): NewFinding[] {
  const { client, locations, pages, paragraphs, runs, clientMentionRate } = input
  const marketRates = input.marketRates ?? []
  const competitors = input.competitors ?? []
  const bar = input.competitiveBar ?? []
  const out: NewFinding[] = []
  const pageById = new Map(pages.map((p) => [p.id, p]))
  // A shop is both: judged on its place like a plumber and on its products
  // like a store, so it is asked for both sets of findings rather than half.
  const isLocal = isPlaceBasedClient(client)
  const isEcom = sellsProductsClient(client)

  // ── 1. Geography: the site points at places the business does not serve.
  const offenders = pages.filter((p) => p.wrongGeoHits > 0)
  const totalHits = offenders.reduce((a, p) => a + p.wrongGeoHits, 0)
  if (offenders.length > 0) {
    const served = locations.map((l) => l.name)
    out.push({
      targetType: 'site',
      category: 'geo-mismatch',
      severity: 'critical',
      issue:
        `The website repeatedly references places the business does not serve. ` +
        `${offenders.length} of ${pages.length} pages contain such references (${totalHits} in total)` +
        (served.length ? `, while the actual service area is ${list(served)}.` : '.'),
      proposedText:
        'Rewrite or retire every page targeting the wrong area, and replace location wording site-wide with the real service area. Until this is corrected, no search or AI system can place the business correctly, and nothing else on this list will work.',
      evidence: offenders
        .sort((a, b) => b.wrongGeoHits - a.wrongGeoHits)
        .slice(0, 12)
        .map((p) => `/${p.slug} (${p.wrongGeoHits})`)
        .join(', '),
    })
  }

  // ── 2. Pages for the places actually served.
  if (locations.length > 0) {
    const haystack = pages.map((p) => p.slug.toLowerCase()).join(' ')
    const missing = locations.filter((l) => {
      const slug = l.name.toLowerCase().replace(/\s+/g, '-')
      return !haystack.includes(slug) && !haystack.includes(slug.replace(/-/g, ''))
    })
    if (missing.length > 0) {
      out.push({
        targetType: 'site',
        category: 'missing-location-pages',
        severity: 'critical',
        issue: `No dedicated page exists for ${missing.length} of the ${locations.length} places the business serves.`,
        proposedText: `Create one page per place: ${list(missing.map((l) => l.name), 12)}. Each needs a direct answer in the first 100 words, real service detail, an FAQ block, and LocalBusiness + Service + FAQPage structured data.`,
        evidence:
          'A place name appearing in an existing slug is not always enough — check that the page is written for that location and not merely named after it. Names shared between regions are especially easy to mistake.',
      })
    }
  }

  // ── 3. Duplicate pages.
  const bySlugRoot = new Map<string, string[]>()
  for (const p of pages) {
    const root = p.slug.replace(/-\d+$/, '')
    bySlugRoot.set(root, [...(bySlugRoot.get(root) ?? []), p.slug])
  }
  const dupes = [...bySlugRoot.entries()].filter(([, v]) => v.length > 1)
  if (dupes.length > 0) {
    out.push({
      targetType: 'site',
      category: 'duplicate-pages',
      severity: 'high',
      issue: `${dupes.length} pages exist more than once. Duplicate content splits ranking signals between copies.`,
      proposedText:
        'Keep one version of each, redirect the other with a 301, and make sure internal links point at the survivor.',
      evidence: dupes.map(([root, v]) => `${root} x${v.length}`).join(', '),
    })
  }

  // ── 4. Structured data.
  /**
   * Subtypes count. A site that marks itself up as `LiquorStore` or `Dentist`
   * has LocalBusiness markup — schema.org is a hierarchy — and telling its owner
   * otherwise is both wrong and actively harmful, because the fix on offer
   * replaces a precise type with a vaguer one.
   */
  const schemaLabel = isEcom ? 'Product' : 'LocalBusiness or Service'
  // Product markup belongs on product pages. Demanding it of an about page or a
  // category listing would inflate the count and point at the wrong fix.
  const schemaScope = isEcom ? pages.filter((p) => p.pageType === 'product') : pages
  const noBusinessSchema = schemaScope.filter((p) => {
    const types = JSON.parse(p.schemaTypes || '[]') as string[]
    return !hasBusinessSchema(types, client.businessType)
  })
  if (noBusinessSchema.length > 0) {
    out.push({
      targetType: 'site',
      category: 'missing-schema',
      severity: 'high',
      issue: `${noBusinessSchema.length} of ${schemaScope.length} ${isEcom ? 'product ' : ''}pages have no ${schemaLabel} structured data. This is one of the strongest signals for being cited in an AI answer.`,
      proposedText: `Add ${schemaLabel} structured data across the site, plus FAQPage markup wherever there is a question-and-answer block.`,
      evidence: list(noBusinessSchema.map((p) => `/${p.slug}`), 10),
    })
  }

  /**
   * Pages whose copy is assembled in the browser.
   *
   * This one is reported before anything about wording, because it decides
   * whether the wording is ever read. ChatGPT, Copilot and Meta AI retrieve
   * through Bing's index, and an engine that does not run JavaScript sees the
   * served HTML — which on these pages is an empty container.
   */
  const clientRendered = pages.filter((p) => p.renderedWordCount !== undefined && p.renderedWordCount < 50)
  if (clientRendered.length > 0) {
    out.push({
      targetType: 'site',
      category: 'javascript-only-content',
      severity: 'critical',
      issue:
        `${clientRendered.length} of ${pages.length} pages serve no readable text — the copy is assembled in the browser. ` +
        `A crawler that does not run JavaScript sees an empty page, so there is nothing to quote and nothing to rank.`,
      proposedText:
        'Server-render the copy, or pre-render it at build time, so the words are in the HTML that arrives. ' +
        'Until then the structured data is the only thing about this business an engine can read.',
      evidence: list(clientRendered.map((p) => `/${p.slug}`), 10),
    })
  }

  const noFaq = pages.filter((p) => !JSON.parse(p.schemaTypes || '[]').includes('FAQPage'))
  if (noFaq.length > pages.length * 0.8) {
    out.push({
      targetType: 'site',
      category: 'missing-faq',
      severity: 'medium',
      issue: `Only ${pages.length - noFaq.length} of ${pages.length} pages carry an FAQ block with structured data. Question-and-answer content is the format AI engines quote most, because it matches how people ask.`,
      proposedText:
        'Add 5-8 real customer questions per key page with short, direct answers. Use the questions customers actually ask.',
    })
  }

  // ── 5. Statistics and citations — the biggest measured lever.
  const substantial = paragraphs.filter((p) => p.wordCount >= 40)
  const noStats = substantial.filter((p) => p.statCount === 0 && !p.hasCitation)
  if (noStats.length > 0) {
    const pct = Math.round((noStats.length / Math.max(1, substantial.length)) * 100)
    out.push({
      targetType: 'site',
      category: 'no-statistics',
      severity: 'high',
      issue: `${noStats.length} of ${substantial.length} substantial paragraphs (${pct}%) contain no statistics and cite no source. Adding concrete numbers and citations was the single biggest measured lever in the GEO research — worth about +40% visibility.`,
      proposedText:
        'Add real, verifiable numbers: response times, quantities, durations, counts, ratings. Cite a manufacturer or standards body where a claim needs backing.',
      evidence: `Worst pages: ${list([...new Set(noStats.map((p) => pageById.get(p.pageId)?.slug ?? ''))].filter(Boolean))}`,
    })

    for (const p of noStats.sort((a, b) => b.wordCount - a.wordCount).slice(0, 15)) {
      out.push({
        targetType: 'paragraph',
        targetId: p.id,
        category: 'no-statistics',
        severity: 'medium',
        issue: `${p.wordCount}-word paragraph on /${pageById.get(p.pageId)?.slug} with no numbers and no source.`,
        currentText: p.text,
        proposedText:
          'Add at least one concrete figure here. Vague reassurance does not get quoted; numbers do.',
      })
    }
  }

  // ── 6. Readability.
  const hard = substantial.filter((p) => p.readability > 0 && p.readability < 50)
  if (hard.length > 0) {
    out.push({
      targetType: 'site',
      category: 'readability',
      severity: 'medium',
      issue: `${hard.length} paragraphs score below 50 on reading ease (hard to read). Improving fluency measured a 15-30% visibility gain in the GEO research. Aim for 60+.`,
      proposedText:
        'Shorten sentences to about 15-20 words, use everyday words instead of industry phrasing, and put the answer in the first sentence of each paragraph.',
      evidence: hard
        .sort((a, b) => a.readability - b.readability)
        .slice(0, 6)
        .map((p) => `/${pageById.get(p.pageId)?.slug} (${p.readability})`)
        .join(', '),
    })
  }

  // ── 7. Superlatives.
  const puffy = paragraphs.filter((p) => p.superlativeCount >= 2)
  const totalSuperlatives = paragraphs.reduce((a, p) => a + p.superlativeCount, 0)
  if (totalSuperlatives > 0) {
    out.push({
      targetType: 'site',
      category: 'superlatives',
      severity: 'medium',
      issue: `${totalSuperlatives} superlative phrases across the site ("best", "#1", "premier", "unbeatable"), with ${puffy.length} paragraphs using two or more. The GEO research measured superlatives as neutral to negative — the opposite of what most SEO copy assumes.`,
      proposedText:
        'Replace each superlative with a verifiable fact. An adjective claims; a number proves.',
      evidence: puffy
        .sort((a, b) => b.superlativeCount - a.superlativeCount)
        .slice(0, 6)
        .map((p) => `/${pageById.get(p.pageId)?.slug} (${p.superlativeCount})`)
        .join(', '),
    })
  }

  // ── 8. Direct answer up front.
  const buried = pages.filter((p) => {
    const first = p.text.split(/\s+/).slice(0, 100).join(' ').toLowerCase()
    return p.wordCount > 150 && !/\b(we|our team|call|book|buy|shop|order|schedule)\b/.test(first)
  })
  if (buried.length > 0) {
    out.push({
      targetType: 'site',
      category: 'no-direct-answer',
      severity: 'medium',
      issue: `${buried.length} pages do not answer the visitor's question in the first 100 words. AI engines extract from the top of a page; a slow opening rarely gets quoted.`,
      proposedText:
        'Open each page with one or two sentences that answer the query directly, then expand.',
      evidence: list(buried.map((p) => `/${p.slug}`)),
    })
  }

  // ── 9. Whether the engines actually name the business.
  const multiMarket = marketRates.length > 1
  if (clientMentionRate.total > 0) {
    const { named, total } = clientMentionRate
    const pct = Math.round((named / total) * 100)
    out.push({
      targetType: 'offsite',
      category: 'ai-visibility',
      severity: named === 0 ? 'critical' : pct < 25 ? 'high' : 'medium',
      issue:
        `${client.name} is named in ${named} of ${total} AI answers (${pct}%)` +
        (multiMarket ? ` across all ${marketRates.length} markets combined.` : '.'),
      proposedText:
        named === 0
          ? 'The business is invisible to AI search. Fix the geography first, then the off-site presence, then the on-page work — in that order.'
          : 'Grow the share of answers by adding the missing pages, statistics and FAQ blocks, and by getting cited on the third-party sites the engines already quote.',
      evidence: `${runs.filter((r) => r.ok).length} successful runs across ${new Set(runs.map((r) => r.engine)).size} engines.`,
    })
  }

  /**
   * ── 9b. The same question, market by market.
   *
   * A combined percentage is the average of contests that have nothing to do
   * with each other. Two branches a hundred miles apart face different rivals
   * and a different map pack, and a business can be the top recommendation in
   * one while being absent from the other. Reported as one number, the strong
   * market hides the weak one and the client fixes the wrong thing.
   */
  if (multiMarket) {
    for (const m of marketRates.filter((r) => r.total > 0)) {
      const pct = Math.round((m.named / m.total) * 100)
      out.push({
        targetType: 'offsite',
        category: 'ai-visibility-market',
        severity: m.named === 0 ? 'critical' : pct < 25 ? 'high' : 'medium',
        issue: `${client.name} is named in ${m.named} of ${m.total} AI answers about ${m.label} (${pct}%).`,
        proposedText:
          m.named === 0
            ? `The business is invisible to AI search in ${m.label}. This market needs its own location pages, its own Google Business Profile listing and its own reviews — presence in another market does not carry across.`
            : `Grow the share of ${m.label} answers with pages, statistics and FAQ blocks written for that market specifically, and citations on the third-party sites the engines quote there.`,
        evidence: `Places measured: ${list(m.locations, 8)}.`,
      })
    }

    /**
     * A market with no answers at all is not a good result — it is a gap in the
     * measurement, and saying nothing about it would read as "nothing wrong".
     */
    const unmeasured = marketRates.filter((r) => r.total === 0)
    if (unmeasured.length > 0) {
      out.push({
        targetType: 'offsite',
        category: 'unmeasured-market',
        severity: 'medium',
        issue: `${unmeasured.length} of the ${marketRates.length} markets served have no AI answers recorded, so their visibility is unknown rather than good.`,
        proposedText: `Run a measurement pass for ${list(unmeasured.map((m) => m.label), 6)} before drawing any conclusion about those places.`,
        evidence: unmeasured
          .map((m) => `${m.label} (${list(m.locations, 4)})`)
          .join('; '),
      })
    }
  }

  // ── 10. Google Business Profile. Only meaningful when the business has one.
  if (hasGoogleProfile(client)) {
    if (client.gbpHasWebsite === false) {
      out.push({
        targetType: 'offsite',
        category: 'gbp-no-website',
        severity: 'critical',
        issue:
          'The Google Business Profile has no website attached. The profile AI engines read for local answers does not link to the site at all.',
        proposedText:
          'Add the website URL to the Google Business Profile. This takes about two minutes and is very likely the highest-value single action available.',
      })
    }

    const reviews = client.gbpReviewCount
    const rating = client.gbpRating
    if (reviews !== null && reviews < 20) {
      const floor = Math.max(...Object.values(RATING_THRESHOLDS))
      const ratingIsFine = rating !== null && rating >= floor
      out.push({
        targetType: 'offsite',
        category: 'too-few-reviews',
        severity: 'critical',
        issue:
          `Only ${reviews} Google reviews. ` +
          (ratingIsFine
            ? `The ${rating}-star rating clears every engine's floor (ChatGPT ${RATING_THRESHOLDS.chatgpt}, Perplexity ${RATING_THRESHOLDS.perplexity}, Gemini ${RATING_THRESHOLDS.gemini}), but ${reviews} reviews is almost no signal.`
            : `AI engines weigh review count and recency, not just the average.`),
        proposedText:
          'Build a review request into the end of every job — a message with a direct link once the work is signed off. Keep them arriving: recent reviews count for more than old ones.',
        evidence: bar.length
          ? `The businesses currently shown above this one average ${Math.round(bar.reduce((a, b) => a + (b.reviewCount ?? 0), 0) / bar.length)} reviews.`
          : 'Enter the top three local results with their ratings and review counts to turn this into a specific target.',
      })
    }

    if (rating !== null) {
      const failing = Object.entries(RATING_THRESHOLDS).filter(([, floor]) => rating < floor)
      if (failing.length > 0) {
        out.push({
          targetType: 'offsite',
          category: 'rating-below-threshold',
          severity: 'critical',
          issue: `The ${rating}-star rating falls below the minimum ${failing.map(([e, f]) => `${e} (${f})`).join(', ')} will recommend. No amount of website work overcomes this.`,
          proposedText:
            'Raising the rating is the first priority. Nothing else on this list can succeed while the business sits below the recommendation floor.',
        })
      }
    }
  }

  // ── 11. Name and phone consistency across the business's own properties.
  //        A ranking factor for a business people call; irrelevant for a store.
  const uniquePhones = new Set(client.phones.filter(Boolean))
  if (isLocal && uniquePhones.size > 1) {
    out.push({
      targetType: 'offsite',
      category: 'nap-inconsistent',
      severity: 'critical',
      issue: `${uniquePhones.size} different phone numbers appear across the business's own properties. Consistent name, address and phone is a core local ranking factor — mismatches actively suppress visibility.`,
      proposedText: client.primaryPhone
        ? `Pick one number (${client.primaryPhone} is the one currently listed publicly) and make it identical everywhere: every page, the profile, and every directory listing.`
        : 'Pick one number and make it identical across every page, profile and directory listing.',
      evidence: [...uniquePhones].join(' · '),
    })
  }

  /**
   * Product and category titles legitimately carry the brand ("Men's Acme Flip
   * Flop"), so counting them here would report dozens of "name variants" that
   * are simply the catalogue. Only editorial pages say the business name in the
   * way this check is about.
   */
  const siteTitles = new Set(
    pages
      // Blog headlines are prose, not statements of the business name.
      .filter((p) => p.pageType === 'page')
      .map((p) => {
        // "Coupons | Acme" — the business name is the tail, not the head, and a
        // homepage often appends a tagline after a colon.
        //
        // The hyphen must be SPACED to count as a separator: "Stafford - Acme
        // Repair" splits, but "Wool Runner-up" is one word and must not.
        const parts = p.title.split(/\s[|–—-]\s|[|–—]/).map((s) => s.trim()).filter(Boolean)
        const tail = parts.length > 1 ? parts[parts.length - 1] : (parts[0] ?? '')
        return tail.split(':')[0].trim().toLowerCase()
      })
      .filter((t) => t.length > 3 && t.length < 45),
  )

  /**
   * A name variant is roughly the same length as the name. "Acmerepairs" is a
   * spelling of "Acme Repairs"; "Find your nearest Acme store" merely mentions
   * it. Without this, every marketing page title containing the brand gets
   * reported as a competing spelling.
   */
  const nameLength = client.name.length
  const nameForms = new Set(
    [
      client.name.toLowerCase(),
      ...[...siteTitles].filter(
        (t) => client.aliases.some((a) => t.includes(a)) && t.length <= nameLength * 1.4,
      ),
    ],
  )
  if (nameForms.size > 1) {
    out.push({
      targetType: 'site',
      category: 'name-inconsistent',
      severity: 'high',
      issue: `The business name appears in ${nameForms.size} different forms across its own pages. This splits the brand signal AI engines use to match a business across sources.`,
      proposedText: `Choose one spelling — ${client.name} — and use it identically in the site title, every page, the profile, and all directory listings.`,
      evidence: list([...nameForms]),
    })
  }

  if (client.gbpServiceArea && locations.length > 0) {
    const covered = locations.some((l) => client.gbpServiceArea!.toLowerCase().includes(l.name.toLowerCase()))
    if (!covered) {
      out.push({
        targetType: 'offsite',
        category: 'service-area-mismatch',
        severity: 'high',
        issue: `The Google Business Profile service area does not overlap the places recorded for this client, so at least one of the two is wrong.`,
        proposedText:
          'Confirm with the business which places they actually travel to, then set the profile service area to match exactly.',
        evidence: `Profile says: ${client.gbpServiceArea} · Recorded: ${list(locations.map((l) => l.name))}`,
      })
    }
  }

  // ── 12. What the winners do differently, from crawling the cited pages.
  const localRivals = competitors.filter((c) => c.ok && !c.isNational && c.pageCount > 0)
  if (localRivals.length > 0) {
    const leaders = isLocal
      ? localRivals.filter((c) => c.cityPageCount > 0).sort((a, b) => b.cityPageCount - a.cityPageCount)
      : []

    if (leaders.length > 0) {
      const avgCity = Math.round(leaders.reduce((a, c) => a + c.cityPageCount, 0) / leaders.length)
      /**
       * Counted, not assumed.
       *
       * This used to end "This site has none", which is true of most clients and
       * badly wrong for the ones who already built the pages — and being told to
       * publish pages that exist is how a client stops believing the rest of the
       * report. Where the count is healthy the gap is what is ON the pages, so
       * the advice changes with it.
       */
      const ownCityPages = pages.filter((p) =>
        locations.some((l) => {
          const slug = l.name.toLowerCase().replace(/\s+/g, '-')
          const own = p.slug.toLowerCase()
          return own.includes(slug) || own.includes(slug.replace(/-/g, ''))
        }),
      ).length

      const standing =
        ownCityPages === 0
          ? 'This site has none.'
          : ownCityPages >= avgCity
            ? `This site has ${ownCityPages}, which matches them on count.`
            : `This site has ${ownCityPages}.`

      out.push({
        targetType: 'site',
        category: 'competitor-location-pages',
        severity: ownCityPages >= avgCity ? 'medium' : 'critical',
        issue: `${leaders.length} of ${localRivals.length} competitors AI recommends are built on location pages, averaging ${avgCity} each. ${standing}`,
        proposedText:
          ownCityPages >= avgCity
            ? 'The pages exist, so the gap is what is on them. Compare them against the rivals listed here for depth, structured data and concrete numbers before writing any new ones.'
            : 'Publish one page per place served, then keep adding them. This is the clearest content pattern among the competitors that win.',
        evidence: leaders
          .map((c) => {
            const pct = c.pageCount ? Math.round((c.cityPageCount / c.pageCount) * 100) : 0
            return `${c.domain}: ${c.cityPageCount}/${c.pageCount} (${pct}%)`
          })
          .join(' · '),
      })
    }

    // The most important nuance: a small site can still win on off-site strength.
    const thin = localRivals.filter((c) => c.pageCount < pages.length / 2)
    if (thin.length > 0) {
      out.push({
        targetType: 'offsite',
        category: 'two-paths-to-visibility',
        severity: 'critical',
        issue: `Website size is not the whole story. ${list(thin.map((c) => `${c.domain} (${c.pageCount} pages)`), 4)} ${thin.length === 1 ? 'is' : 'are'} recommended by AI despite having far smaller sites than this one's ${pages.length} pages. Their visibility comes from off-site presence rather than content volume.`,
        proposedText:
          'Two routes work, and this business is on neither. Route A is content: location pages, FAQs, real numbers. Route B is off-site authority: a complete business profile, a steady flow of reviews, and consistent listings on the directories the engines already cite. Route B is faster and cheaper — start there.',
        evidence: `This site has ${pages.length} pages and is named in ${clientMentionRate.named} of ${clientMentionRate.total} answers.`,
      })
    }

    const avgStats = Math.round((localRivals.reduce((a, c) => a + c.statsPerThousand, 0) / localRivals.length) * 10) / 10
    const myWords = substantial.reduce((a, p) => a + p.wordCount, 0)
    const myRate = myWords ? Math.round((substantial.reduce((a, p) => a + p.statCount, 0) / myWords) * 1000 * 10) / 10 : 0
    if (avgStats > myRate * 2) {
      out.push({
        targetType: 'site',
        category: 'competitor-statistics',
        severity: 'high',
        issue: `Competitors use roughly ${Math.round(avgStats / Math.max(0.1, myRate))}x more concrete numbers. They average ${avgStats} statistics per 1,000 words; this site has ${myRate}.`,
        proposedText:
          'Put real figures into the copy. This was the largest measured lever in the research, and the competitors are already doing it.',
        evidence: localRivals.map((c) => `${c.domain}: ${c.statsPerThousand}/1k`).join(' · '),
      })
    }

    const withFaq = localRivals.filter((c) => c.faqBlockCount > 0)
    if (withFaq.length > 0) {
      const avgFaq = Math.round(withFaq.reduce((a, c) => a + c.faqBlockCount, 0) / withFaq.length)
      out.push({
        targetType: 'site',
        category: 'competitor-faq',
        severity: 'high',
        issue: `${withFaq.length} of ${localRivals.length} competitors run FAQ blocks, averaging ${avgFaq} questions. This site has none.`,
        proposedText:
          'Add 5-8 real customer questions per key page with short direct answers, marked up as FAQPage structured data.',
        evidence: withFaq.map((c) => `${c.domain}: ${c.faqBlockCount}`).join(' · '),
      })
    }
  }

  // ── 13. The competitive bar, when it has been recorded.
  if (bar.length > 0 && client.gbpReviewCount !== null) {
    const leader = bar.slice().sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0))[0]
    if (leader?.reviewCount && leader.reviewCount > client.gbpReviewCount) {
      out.push({
        targetType: 'offsite',
        category: 'review-gap',
        severity: 'high',
        issue: `The leading local result has ${leader.reviewCount} reviews at ${leader.rating ?? '?'} stars. This business has ${client.gbpReviewCount}.`,
        proposedText: `Target ${leader.reviewCount} reviews to match the leader. At two review requests per job that is a reachable number; the gap is currently ${leader.reviewCount - client.gbpReviewCount}.`,
        evidence: bar
          .sort((a, b) => a.rank - b.rank)
          .map((b) => `${b.rank}. ${b.businessName} ${b.rating ?? '?'}★ (${b.reviewCount ?? '?'})`)
          .join(' · '),
      })
    }
  }

  // ── 13b. Online stores fail in their own particular ways.
  if (isEcom) {
    const products = pages.filter((p) => p.pageType === 'product')
    const collections = pages.filter((p) => p.pageType === 'collection')

    /**
     * The biggest structural gap a store has. Someone asking an assistant which
     * product to buy gets an answer built from comparisons and guides — the
     * formats that weigh options. A catalogue of product pages has nothing for
     * an engine to quote, however good the products are.
     */
    const guideish = /\b(guide|how-to|how to|vs|versus|compare|comparison|best|choosing|buying)\b/
    const guides = pages.filter((p) => guideish.test(p.slug) || guideish.test(p.title))
    if (guides.length < 3 && products.length > 0) {
      out.push({
        targetType: 'site',
        category: 'no-buying-guides',
        severity: 'critical',
        issue: `${products.length} product pages but only ${guides.length} comparison or guide pages. AI assistants answer "which should I buy" from guides and comparisons, not from product listings — so a catalogue alone gives them nothing to quote.`,
        proposedText:
          'Publish a buying guide per product category: what actually matters when choosing, the common mistakes, and honest price ranges. This is the format that gets cited.',
        evidence: guides.length > 0 ? `Existing: ${list(guides.map((p) => `/${p.slug}`), 5)}` : 'No guide content found at all.',
      })
    }

    const thinProducts = products.filter((p) => p.wordCount < 60)
    if (thinProducts.length > products.length * 0.3 && thinProducts.length > 0) {
      out.push({
        targetType: 'site',
        category: 'thin-product-pages',
        severity: 'high',
        issue: `${thinProducts.length} of ${products.length} product pages carry under 60 words. There is too little there for an engine to summarise, so they get skipped in favour of retailers that describe the same product properly.`,
        proposedText:
          'Expand each to answer what it is for, who it suits, what it is made of, and how it compares to the alternatives. Specifics get quoted; adjectives do not.',
        evidence: list(thinProducts.map((p) => `/${p.slug}`), 6),
      })
    }

    const thinCollections = collections.filter((p) => p.wordCount < 40)
    if (thinCollections.length > 0 && collections.length > 0) {
      out.push({
        targetType: 'site',
        category: 'empty-collection-pages',
        severity: 'high',
        issue: `${thinCollections.length} of ${collections.length} category pages have almost no text. Category pages are what rank for "best <product>" searches, and an empty one cannot rank for anything.`,
        proposedText:
          'Add a genuine introduction to each category: what the range covers, how to choose between the options, and who each suits. A few hundred words turns a listing into a page that can be cited.',
        evidence: list(thinCollections.map((p) => `/${p.slug}`), 6),
      })
    }

    const noReviewMarkup = products.filter((p) => {
      const types = JSON.parse(p.schemaTypes || '[]') as string[]
      return !types.some((t) => /AggregateRating|Review/i.test(t))
    })
    if (noReviewMarkup.length > products.length * 0.8 && products.length > 0) {
      out.push({
        targetType: 'site',
        category: 'no-review-markup',
        severity: 'medium',
        issue: `${noReviewMarkup.length} of ${products.length} product pages carry no review or rating markup. Ratings are one of the few signals an engine can compare directly between competing products.`,
        proposedText:
          'Add AggregateRating and Review structured data wherever real reviews exist. Never mark up ratings the products do not actually have.',
      })
    }

    const vagueTitles = products.filter((p) => {
      const title = p.title.toLowerCase()
      return !client.offerings.some((o) =>
        o.split(/\s+/).filter((w) => w.length > 3).some((w) => title.includes(w)),
      )
    })
    if (vagueTitles.length > products.length * 0.5 && products.length > 0) {
      out.push({
        targetType: 'site',
        category: 'product-titles-lack-category',
        severity: 'medium',
        issue: `${vagueTitles.length} of ${products.length} product titles never say what the product actually is — they carry only a model or colour name. Someone searching for the category will not match them, and neither will an engine.`,
        proposedText:
          'Include the category in every product title: "<Model> — <Category>". A name alone only works for people who already know the brand.',
        evidence: list(vagueTitles.slice(0, 5).map((p) => p.title), 5),
      })
    }
  }

  // ── 14. Bing. Free, fast, and almost nobody does it.
  out.push({
    targetType: 'offsite',
    category: 'bing-index',
    severity: 'high',
    issue:
      'ChatGPT, Copilot and Meta AI retrieve through Bing’s index, not Google’s. A site that is weak in Bing is invisible to those engines regardless of Google rankings.',
    proposedText:
      'Set up Bing Webmaster Tools, submit the sitemap, and confirm the key pages get indexed. It is free and takes about 20 minutes.',
  })

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}
