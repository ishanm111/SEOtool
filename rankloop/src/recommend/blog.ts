import type { PageRow, Recommendation, RecommendInput } from './types'
import { FILL } from './types'
import {
  angleOf,
  isInformational,
  keywordTopics,
  topicCandidates,
  type Keyword,
  type KeywordCluster,
} from './keywords'
import { isPlaceBasedClient, sellsProductsClient, type Client, type ClientLocation } from '../lib/client'
import type { ClientFacts } from '../onboard/questionnaire'
import { deriveTrade, isVisitTrade } from '../lib/trade'

/**
 * Blog posts the site is missing, one per keyword topic.
 *
 * The generator beside this one writes the pages a business needs to exist at
 * all — a location page, a buying guide. This one writes the pages that answer
 * a question, and the difference matters: an engine asked "how long does this
 * take" does not quote a service page, it quotes whoever answered.
 *
 * The topics are not invented. They come out of Search Console, out of the
 * question set the engines are actually asked, and out of the client's own
 * offerings — never out of a list of industry article ideas in this file.
 *
 * Same rules as everything else here: the question is answered in the first
 * hundred words, sentences stay short, there are no superlatives, and every
 * claim only the business can verify is a visible placeholder rather than
 * invented text. A blog post is the easiest place in this tool to accidentally
 * publish a made-up statistic on somebody's live website, so the skeleton
 * carries the structure and the business carries the facts.
 */

/** How many posts one run proposes. A backlog nobody works through is not a plan. */
const MAX_POSTS = 12

const WORDS = /[^a-z0-9]+/g

/**
 * Filler a URL does not need. Dropped so the words that say what the post is
 * about survive the length cap — "what is a normal call-out fee for appliance"
 * was cut off before "repair", which is the one word the slug could not afford
 * to lose.
 */
const SLUG_FILLER = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'it', 'its', 'to', 'of', 'in', 'on', 'at',
  'for', 'do', 'does', 'did', 'and', 'or', 'my', 'your', 'i', 'you', 'that',
  'this', 'be', 'been', 'am', 'much', 'many', 'can',
])

const slugify = (text: string, maxWords = 8) => {
  const all = text
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, '')
    .replace(WORDS, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  // Falling back to the full phrase matters: a topic that is nothing but filler
  // words would otherwise slug to an empty string and be silently dropped.
  const meaningful = all.filter((w) => !SLUG_FILLER.has(w))
  return (meaningful.length >= 3 ? meaningful : all).slice(0, maxWords).join('-')
}

/**
 * The right indefinite article, so a generated headline does not read as
 * machine-written on the first word a person sees.
 */
const article = (word: string) => (/^[aeiou]/i.test(word.trim()) ? 'an' : 'a')

/**
 * Where this site keeps its posts, read off the posts it already has.
 *
 * A site whose blog lives at /news/ or /advice/ should not be handed a dozen
 * slugs under /blog/ that do not match anything in its own information
 * architecture. Falls back to /blog/ only when there is nothing to read.
 */
export function blogBasePath(pages: PageRow[]): string {
  const counts = new Map<string, number>()
  for (const page of pages) {
    if (page.pageType !== 'post') continue
    let path: string
    try {
      path = new URL(page.url).pathname
    } catch {
      continue
    }
    const segments = path.split('/').filter(Boolean)
    if (segments.length < 2) continue
    const base = `/${segments.slice(0, -1).join('/')}/`
    counts.set(base, (counts.get(base) ?? 0) + 1)
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return best ? best[0] : '/blog/'
}

/**
 * Whether the site already answers this topic.
 *
 * Deliberately strict about what counts. A service page named "Dryer Repair"
 * shares two words with "how long does dryer repair take" and answers neither
 * of them, so overlap on the topic nouns alone is not coverage — the page has
 * to carry the word that makes the question a question. Getting this wrong in
 * the lenient direction silently drops the most valuable post in the set.
 */
function alreadyCovered(cluster: KeywordCluster, pages: PageRow[]): PageRow | null {
  const informational = cluster.keywords
    .flatMap((k) => k.stem)
    .filter((w, i, all) => all.indexOf(w) === i && isInformational(w))
  const nouns = cluster.stem.filter((w) => !isInformational(w))

  for (const page of pages) {
    const haystack = `${page.slug} ${page.title}`.toLowerCase().replace(WORDS, ' ')
    const hasNouns = nouns.filter((w) => haystack.includes(w)).length >= Math.min(2, nouns.length)
    const hasAngle = informational.some((w) => haystack.includes(w))
    if (hasNouns && hasAngle) return page

    // An article that already asks the question verbatim, whatever it is named.
    const body = page.text.toLowerCase()
    if (cluster.keywords.some((k) => k.text.length > 20 && body.includes(k.text.toLowerCase()))) {
      return page
    }
  }
  return null
}

/**
 * The intake answer that already answers this topic, if there is one.
 *
 * A client who has told us their price band should not be handed a placeholder
 * asking for it again. Matched on the topic words rather than on the question
 * text, so it works whatever wording the search term arrived in.
 */
function factFor(cluster: KeywordCluster, facts: ClientFacts): string | null {
  const stem = new Set(cluster.stem)
  const has = (...ws: string[]) => ws.some((w) => stem.has(w))
  if (has('cost', 'costs', 'price', 'prices', 'pricing', 'expensive', 'cheap', 'cheapest')) {
    return facts.price_detail ?? facts.price_band ?? null
  }
  if (has('warranty', 'guarantee')) return facts.warranty ?? null
  if (has('return', 'returns', 'refund')) return facts.returns ?? null
  if (has('shipping', 'delivery')) return facts.shipping ?? null
  if (has('long', 'often', 'take', 'takes', 'soon')) return facts.response_time ?? null
  if (has('open', 'hours')) return facts.opening_hours ?? null
  return null
}

/** The sibling terms that become the FAQ, deduped down to distinct questions. */
function faqTerms(cluster: KeywordCluster, named: Keyword): Keyword[] {
  const seen = new Set<string>([named.stem.join(' ')])
  return cluster.keywords
    .filter((k) => {
      if (k === named || !isInformational(k.text)) return false
      const key = k.stem.join(' ')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 4)
}

const questionForm = (text: string) => {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return /\?$/.test(trimmed) ? trimmed : `${trimmed}?`
}

function blogPost(input: {
  client: Client
  locations: ClientLocation[]
  cluster: KeywordCluster
  /** The keyword this post is named after, already chosen against the quota. */
  named: Keyword
  facts: ClientFacts
}): { title: string; description: string; html: string; faqs: { q: string; a: string }[] } {
  const { client, locations, cluster, named, facts } = input
  const trade = deriveTrade(client)
  const visit = client.businessType === 'local_retail' || (trade !== null && isVisitTrade(trade))
  const topic = named.display
  const asks = /\?/.test(topic) || /^(how|why|when|what|which|should|can|do|does|is|are)\b/i.test(topic)
  const title = asks ? questionForm(topic) : topic
  const known = factFor(cluster, facts)
  const subject = cluster.stem.filter((w) => !isInformational(w)).slice(0, 3).join(' ') || (trade ?? 'this')

  /**
   * The answer goes first, before any preamble.
   *
   * This is the single rule that decides whether an engine can quote the page:
   * a post that spends two paragraphs introducing itself gets skipped for one
   * that answers in its opening line. Where the business has already told us
   * the answer it is used verbatim; where it has not, the placeholder says so.
   */
  const lead = known
    ? `<p><strong>${known}</strong> ${FILL(
        'one sentence of context for the answer above — what changes it, or who it does not apply to',
      )}</p>`
    : `<p><strong>${FILL(
        `the answer to "${title}" in one or two sentences, stated plainly and up front. This is the paragraph an AI assistant quotes, so it has to answer before it explains.`,
      )}</strong></p>`

  const faqs = faqTerms(cluster, named).map((k) => ({
    q: questionForm(k.display),
    a:
      factFor({ ...cluster, stem: k.stem }, facts) ??
      FILL(`a short, direct answer to "${questionForm(k.text)}" — two or three sentences`),
  }))

  const where = locations[0]
    ? `${locations[0].name}${locations[0].region ? `, ${locations[0].region}` : ''}`
    : null
  const phone = client.primaryPhone ?? FILL('phone number')

  /**
   * How the business describes itself is not a sentence that can be assembled
   * from a template alone: "we are an appliance repair in Richmond" is not
   * English. A shop is a thing you can be one of; a trade is something you
   * provide. The location pages already draw this line, and the two say the
   * same thing about the same business or one of them is wrong.
   */
  const standing =
    trade === null || where === null
      ? ''
      : visit
        ? `We are ${article(trade)} ${trade} in ${where}. `
        : `We provide ${trade} across ${where}. `

  // A shop has no jobs to turn anything into, and a business that comes to you
  // has nothing on a shelf to check. The two closers are not interchangeable.
  const cta = isPlaceBasedClient(client)
    ? `<h2>${visit ? 'Come and ask us' : 'Talk to us about it'}</h2>
<p>${standing}${
        visit
          ? `Call ${phone} to check we have something in, or come in and ask.`
          : `Call ${phone} and ask — we will give you an answer whether or not it turns into a job.`
      }</p>`
    : `<h2>Where this leaves you</h2>
<p>${FILL(
        `a short, factual close: what to do next, and a link to the ${sellsProductsClient(client) ? 'collection' : 'service'} page for ${subject}. No sales language — the post has to be worth reading on its own.`,
      )}</p>`

  const html = [
    `<h1>${title}</h1>`,
    lead,
    `<h2>What actually decides it</h2>
<p>${FILL(
      `the two or three things that genuinely change the answer to "${title}", in your own words. Be specific — this is the section that separates a post an engine quotes from one it ignores.`,
    )}</p>`,
    `<h2>Numbers worth quoting</h2>
<p>${FILL(
      'two or three real figures with the source named beside each one — a price range you actually charge, a typical timescale, a failure rate from a manufacturer or trade body. Statistics with a named source are the single largest measured lever on whether an AI engine cites a page, so this section is worth more than the rest of the post combined. Leave it out entirely rather than estimating.',
    )}</p>`,
    faqs.length > 0
      ? `<h2>People also ask</h2>\n${faqs.map((f) => `<h3>${f.q}</h3>\n<p>${f.a}</p>`).join('\n')}`
      : '',
    cta,
  ]
    .filter(Boolean)
    .join('\n\n')

  const description = asks
    ? `${title.replace(/\?$/, '')} — answered plainly, with what changes it.`
    : `${title}: what matters, what it costs you to get wrong, and what to do about it.`

  return { title, description, html: html.trim(), faqs }
}

function jsonLd(input: {
  client: Client
  url: string
  title: string
  description: string
  faqs: { q: string; a: string }[]
}): string {
  const { client, url, title, description, faqs } = input
  const graph: unknown[] = [
    {
      '@type': 'BlogPosting',
      headline: title,
      description,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      author: { '@type': 'Organization', name: client.name },
      publisher: { '@type': 'Organization', name: client.name },
      // Never guessed: a wrong publication date on a live post is a claim about
      // when the business said something, and only the CMS knows the truth.
      datePublished: FILL('publication date, in YYYY-MM-DD — your CMS will normally fill this in'),
    },
  ]
  if (faqs.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    })
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2)
}

/**
 * `claimed` is every target another generator has already taken this run.
 *
 * A post about "<trade> in <town>" published beside the location page for that
 * town splits the exact signal the page exists to concentrate, and a client
 * handed both has been told to do the same work twice.
 */
export function recommendBlogPosts(
  input: RecommendInput,
  claimed: ReadonlySet<string> = new Set(),
): Recommendation[] {
  const { client, locations, pages, facts = {}, searchQueries = [], prompts = [] } = input

  const topics = keywordTopics({ client, locations, searchQueries, prompts })
  if (topics.length === 0) return []

  // Same rule as the pages generator: a page written for the wrong region is
  // not coverage of anything, so it cannot suppress a post either.
  const genuinePages = pages.filter((p) => p.wrongGeoHits === 0)
  const base = blogBasePath(genuinePages)

  const out: Recommendation[] = []
  const usedSlugs = new Set<string>()
  /**
   * How many posts may ask the same shape of question.
   *
   * Without this the set fills with "how long does <appliance> repair take"
   * eight times over, because a business with eight offerings generates the
   * same question about each of them. Two is enough to show the pattern is
   * worth pursuing; past that the cluster is renamed to its next-best question
   * instead of being dropped, so nothing is lost — the post just asks something
   * the set has not already asked.
   */
  const MAX_PER_ANGLE = 2
  const perAngle = new Map<string, number>()

  for (const cluster of topics) {
    if (out.length >= MAX_POSTS) break

    const covered = alreadyCovered(cluster, genuinePages)
    if (covered) continue

    const named = topicCandidates(cluster).find((candidate) => {
      const angle = angleOf(candidate)
      return (perAngle.get(angle) ?? 0) < MAX_PER_ANGLE
    })
    if (!named) continue

    const slug = slugify(named.display)
    if (slug.length < 6 || usedSlugs.has(slug)) continue

    const target = `${base}${slug}/`
    if (claimed.has(target.toLowerCase())) continue
    usedSlugs.add(slug)
    perAngle.set(angleOf(named), (perAngle.get(angleOf(named)) ?? 0) + 1)

    const post = blogPost({ client, locations, cluster, named, facts })
    const url = `${client.homepageUrl.replace(/\/$/, '')}${target}`

    /**
     * A topic with real impressions behind it outranks one the tool inferred,
     * and a topic already ranking on page two outranks a cold start — that is
     * a post one rewrite away from traffic rather than a bet.
     */
    const priority = cluster.measured
      ? cluster.bestPosition !== null && cluster.bestPosition <= 20
        ? 82
        : 78
      : cluster.keywords.some((k) => k.source === 'question_set')
        ? 72
        : 66

    const evidence = cluster.measured
      ? `${cluster.impressions.toLocaleString()} impressions in Search Console across ${cluster.keywords.length} related ` +
        `queries, ${cluster.clicks} clicks` +
        (cluster.bestPosition !== null ? `, best average position ${cluster.bestPosition.toFixed(1)}` : '') +
        '. The demand is measured, not estimated.'
      : cluster.keywords.some((k) => k.source === 'question_set')
        ? `This is one of the questions we put to the AI engines for ${client.name}, and nothing on the site answers it. ` +
          `An engine answering it has to quote somebody, and right now that is a competitor.`
        : `Derived from what the business says it does. Nothing on the site answers it, and it is the kind of question ` +
          `an assistant is asked far more often than a search box is.`

    out.push({
      pageId: null,
      kind: 'blog_post',
      target,
      currentValue: null,
      proposedValue: `${post.html}\n\n<script type="application/ld+json">\n${jsonLd({
        client,
        url,
        title: post.title,
        description: post.description,
        faqs: post.faqs,
      })}\n</script>`,
      reason:
        `No post answers "${post.title}". ${evidence} ` +
        `Product and service pages are rarely cited for a question — the page that answers it is.`,
      priority,
    })
  }

  return out
}
