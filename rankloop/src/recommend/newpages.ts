import type { Recommendation, RecommendInput } from './types'
import { FILL } from './types'
import type { Client, ClientLocation } from '../lib/client'
import type { ClientFacts } from '../onboard/questionnaire'
import { deriveTrade, isVisitTrade } from '../lib/trade'

/**
 * Whole pages the site is missing.
 *
 * Built to the GEO rules from the start: the question is answered in the first
 * hundred words, sentences stay short, there are no superlatives, and every
 * claim that only the business can verify is a visible placeholder rather than
 * invented text.
 *
 * Nothing here knows an industry. Services, categories and places all arrive
 * through the client record.
 */

const titleCase = (s: string) =>
  s.replace(/\b\w/g, (c) => c.toUpperCase())

function servicesList(client: Client): string {
  if (client.offerings.length === 0) return ''
  const items = client.offerings
    .slice(0, 12)
    .map((o) => `  <li>${titleCase(o)}</li>`)
    .join('\n')
  return `<h2>What we ${client.businessType === 'ecommerce' ? 'sell' : 'do'}</h2>\n<ul>\n${items}\n</ul>`
}

/**
 * A location page for a local business.
 *
 * `trade` is passed in rather than derived here: a page cannot be written for a
 * business whose trade could not be read off its own site, and that decision
 * belongs at the point where generation is refused.
 */
function locationPage(
  client: Client,
  location: ClientLocation,
  trade: string,
  facts: ClientFacts,
): { slug: string; html: string; faqs: { q: string; a: string }[] } {
  const where = `${location.name}${location.region ? `, ${location.region}` : ''}`
  const visit = isVisitTrade(trade)
  const phone = client.primaryPhone ?? FILL('phone number')
  const slug = `${trade.replace(/\s+/g, '-')}-${location.name.toLowerCase().replace(/\s+/g, '-')}`

  const faqs = [
    {
      q: `Do you cover ${location.name}?`,
      a: `Yes. We work throughout ${where} and the surrounding area. If you are not sure whether you are in range, call ${phone} and ask.`,
    },
    visit
      ? {
          q: `What are your opening hours?`,
          a:
            [facts.opening_hours, facts.access_notes].filter(Boolean).join(' ') ||
            FILL(
              `the days and hours you are open, and anything customers in ${location.name} should know about parking or access`,
            ),
        }
      : {
          q: `How soon can you help in ${location.name}?`,
          a:
            facts.response_time ??
            FILL(
              `typical response time for ${location.name} — e.g. "Usually the same day, and always within 48 hours."`,
            ),
        },
    {
      /**
       * The pricing model is not assumed. A call-out fee plus parts is how a
       * repair trade charges; a fixed price per job, an hourly rate or a quote
       * after a survey are all just as common, and stating the wrong one is the
       * same failure as inventing a number.
       */
      q: `How much does it cost?`,
      a: `${
        facts.price_detail ??
        FILL(
          'how you charge — e.g. a call-out fee plus parts and labour, a fixed price per job, or an hourly rate',
        )
      } We give you a price before any work starts.`,
    },
    {
      q: `Do you guarantee your work?`,
      a:
        facts.warranty ??
        FILL('warranty terms — do not publish until the business has confirmed these in writing'),
    },
  ]

  const intro = visit
    ? `
<p><strong>${client.name} is a ${trade} serving ${where}.</strong> Call ${phone} or come in. ${FILL(
        'one sentence on what makes the visit worth it — range, staff knowledge, or opening hours',
      )}</p>
<p>${FILL(`what customers from ${location.name} most often come in for`)}</p>`.trim()
    : `
<p><strong>${client.name} provides ${trade} across ${where}.</strong> Call ${phone} to book. ${FILL(
        'one sentence on availability — e.g. "We usually attend the same day."',
      )}</p>
<p>Tell us what you need when you get in touch, and we will give you a time window and a price before any work starts.</p>`.trim()

  const local = `
<h2>Working across ${where}</h2>
<p>We cover ${location.name} and the surrounding area${
    location.metro && location.metro !== location.name ? `, including the wider ${location.metro} area` : ''
  }.</p>
<p>${FILL(
    `one or two sentences about ${location.name} specifically — the neighbourhoods you cover, or something true about the local housing stock. Generic text here is what makes a location page look automated.`,
  )}</p>`.trim()

  const faqHtml = `<h2>Common questions</h2>\n${faqs
    .map((f) => `<h3>${f.q}</h3>\n<p>${f.a}</p>`)
    .join('\n')}`

  const cta = visit
    ? `
<h2>Visit our ${trade} from ${location.name}</h2>
<p>Call ${phone} with a question, or come in. ${FILL('address and the easiest way to find you from this location')}</p>`.trim()
    : `
<h2>Book ${trade} in ${location.name}</h2>
<p>Call ${phone} or use the contact form. We will confirm a time and a price before any work starts.</p>`.trim()

  const html = [
    `<h1>${titleCase(trade)} in ${where}</h1>`,
    intro,
    servicesList(client),
    local,
    faqHtml,
    cta,
  ]
    .filter(Boolean)
    .join('\n\n')

  return { slug, html, faqs }
}

/** A buying guide for a store — the format AI quotes instead of product pages. */
function buyingGuide(
  client: Client,
  category: string,
  facts: ClientFacts,
): { slug: string; html: string; faqs: { q: string; a: string }[] } {
  const slug = `how-to-choose-${category.replace(/\s+/g, '-')}`
  const cat = titleCase(category)

  const faqs = [
    {
      q: `What should I look for in ${category}?`,
      a: FILL(
        `three or four things that genuinely matter when choosing ${category}, in your own words. This is the section AI engines quote most, so make it specific.`,
      ),
    },
    {
      q: `How much should I expect to pay for ${category}?`,
      a: facts.price_detail ?? FILL(`honest price range for ${category}, including what changes the price`),
    },
    {
      // Not "size or fit" — that is only a question for things you wear. Care and
      // longevity is asked of every category, and it is the answer a store can give
      // that a marketplace listing cannot.
      // No "so it lasts" tail: a category can be singular or plural and the
      // pronoun would have to agree with it.
      q: `How do I care for ${category}?`,
      a: FILL(
        `care, storage or usage guidance for ${category} — and anything that would void the guarantee`,
      ),
    },
    {
      q: `What is your returns policy?`,
      a: facts.returns ?? FILL('returns window and conditions — do not publish until confirmed'),
    },
  ]

  const html = [
    `<h1>How to Choose ${cat}</h1>`,
    `<p><strong>This guide covers what actually matters when choosing ${category}, and how to avoid the common mistakes.</strong> ${FILL(
      'one sentence saying who this guide is for',
    )}</p>`,
    `<h2>What matters most</h2>\n<p>${FILL(
      `the two or three factors that genuinely separate good ${category} from bad. Be specific — a comparison an engine can quote is worth far more than a description of your own range.`,
    )}</p>`,
    `<h2>Common mistakes</h2>\n<p>${FILL(`the mistakes people make when buying ${category}, and what to do instead`)}</p>`,
    `<h2>Common questions</h2>\n${faqs.map((f) => `<h3>${f.q}</h3>\n<p>${f.a}</p>`).join('\n')}`,
    `<h2>Our ${category}</h2>\n<p>${FILL(
      `a short, factual paragraph about your own ${category} and a link to the collection page`,
    )}</p>`,
  ].join('\n\n')

  return { slug, html, faqs }
}

function faqSchema(faqs: { q: string; a: string }[]) {
  return JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
    null,
    2,
  )
}

export function recommendNewPages(input: RecommendInput): Recommendation[] {
  const { client, locations, pages, facts = {} } = input
  const out: Recommendation[] = []

  /**
   * A page only counts as covering a location if it is actually written for it.
   *
   * Place names repeat across regions — a site built for the wrong area can hold
   * a page named after a town the business genuinely serves, while being about
   * the identical town in another state. Treating that as coverage silently
   * skips the most important page the client needs, so pages flagged as pointing
   * outside the service area are excluded from this check.
   */
  const genuinePages = pages.filter((p) => p.wrongGeoHits === 0)
  const existingSlugs = genuinePages.map((p) => p.slug.toLowerCase()).join(' ')
  const misleading = pages.filter((p) => p.wrongGeoHits > 0).map((p) => p.slug.toLowerCase())

  const trade = deriveTrade(client)

  /**
   * No trade, no pages. A location page whose every heading says "service"
   * because that was the fallback noun is worse than the missing page it
   * replaces — it publishes a claim about the business that nobody checked.
   */
  if (client.businessType === 'local_service' && trade === null) return out

  if (client.businessType === 'local_service' && trade !== null) {
    for (const location of locations) {
      const key = location.name.toLowerCase().replace(/\s+/g, '-')
      if (existingSlugs.includes(key) || existingSlugs.includes(key.replace(/-/g, ''))) continue
      const clash = misleading.find((s) => s.includes(key) || s.includes(key.replace(/-/g, '')))

      const { slug, html, faqs } = locationPage(client, location, trade, facts)
      out.push({
        pageId: null,
        kind: 'new_page',
        target: `/${slug}/`,
        currentValue: null,
        proposedValue: `${html}\n\n<script type="application/ld+json">\n${faqSchema(faqs)}\n</script>`,
        reason: clash
          ? `No page targets ${location.name}. There IS a /${clash} page, but it is written for a place outside the ` +
            `service area — the same town name in another region — so it does not cover this location and must not be ` +
            `mistaken for it. Competitors that AI recommends are built on location pages.`
          : `No page targets ${location.name}. Competitors that AI recommends are built on location pages, and a business ` +
            `cannot be recommended for a place its site never covers.`,
        priority: clash ? 94 : 90,
      })
    }
  } else {
    const categories = client.offerings.slice(0, 6)
    for (const category of categories) {
      const key = `how-to-choose-${category.replace(/\s+/g, '-')}`
      if (existingSlugs.includes(key)) continue

      const { slug, html, faqs } = buyingGuide(client, category, facts)
      out.push({
        pageId: null,
        kind: 'new_page',
        target: `/${slug}/`,
        currentValue: null,
        proposedValue: `${html}\n\n<script type="application/ld+json">\n${faqSchema(faqs)}\n</script>`,
        reason:
          `No buying guide exists for ${category}. When someone asks an AI assistant which ${category} to buy, it quotes ` +
          `comparison and guide content — product pages alone are rarely cited.`,
        priority: 84,
      })
    }
  }

  return out
}
