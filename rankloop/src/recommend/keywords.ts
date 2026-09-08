import type { Client, ClientLocation } from '../lib/client'
import { normaliseState } from '../onboard/us-states'
import { deriveTrade, isVisitTrade, splitOffering } from '../lib/trade'
import { SUPERLATIVE_PATTERN, type PromptRow, type SearchQueryRow } from './types'

/**
 * Every search term the tool knows about a client, in one pool.
 *
 * Three sources, and they are not interchangeable:
 *
 *  - Search Console: what people actually typed to reach this site, with real
 *    impressions and a real position. A measurement, not an estimate, and the
 *    only source that can say a topic already has demand.
 *  - The question set: the questions we put to the AI engines. Not proof of
 *    demand, but it is the exact wording the client is being judged on, so a
 *    topic the engines were asked about and the site never covers is a gap
 *    this tool measured itself.
 *  - The client's own offerings: the floor. A site with no Search Console
 *    access and no run yet still gets a keyword pool, derived from what the
 *    business says it does.
 *
 * Nothing here names an industry or a place. Every noun arrives on the client
 * record, exactly as everywhere else in this module.
 */

export type KeywordSource = 'search_console' | 'question_set' | 'offering'

export type Keyword = {
  /** The phrase as it was searched or asked. Kept verbatim for FAQ headings. */
  text: string
  source: KeywordSource
  /** Real Search Console impressions. Zero for a term the tool derived itself. */
  impressions: number
  clicks: number
  /** Average Google position, or null for a term that was never measured. */
  position: number | null
  /** Topic words: brand, place and filler words removed. */
  stem: string[]
  /** The term as a headline: the client's own name and towns taken out. */
  display: string
}

export type KeywordCluster = {
  /**
   * What the post is about.
   *
   * Named by the best question in the cluster, never simply by the heaviest
   * term. "Microwave repair Glen Allen VA" outweighs everything around it and
   * is a location page — naming the post after it produces an article that
   * competes with the page that should rank for it.
   */
  topic: string
  /** Every term in the cluster, heaviest first. The first one names it. */
  keywords: Keyword[]
  stem: string[]
  impressions: number
  clicks: number
  /** True when at least one member is a real Search Console query. */
  measured: boolean
  /** Best average Google position across measured members. Null when none. */
  bestPosition: number | null
}

/**
 * Words that carry no topic.
 *
 * Deliberately excludes every word that changes what a page has to say — "cost",
 * "vs", "long", "often" and the rest stay, because "dryer repair" and "dryer
 * repair cost" are two different posts and collapsing them loses one of them.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'by',
  'for', 'from', 'with', 'about', 'into', 'over', 'after', 'is', 'are', 'was',
  'were', 'be', 'been', 'am', 'do', 'does', 'did', 'doing', 'have', 'has', 'had',
  'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'must',
  'i', 'me', 'my', 'mine', 'we', 'our', 'us', 'you', 'your', 'it', 'its', 'they',
  'them', 'their', 'there', 'here', 'this', 'that', 'these', 'those', 'who',
  'whom', 'which', 'what', 'when', 'where', 'why', 'how', 'much', 'many', 'get',
  'got', 'need', 'needs', 'want', 'find', 'looking', 'near', 'nearby',
  'someone', 'somebody', 'anyone', 'any', 'some', 'not', 'no', 'yes', 'please',
  'recommend', 'recommendation', 'recommendations', 'good', 'really', 'actually',
  'just', 'now', 'today', 'still', 'very', 'too', 'so', 'than', 'then', 'up',
  'out', 'down', 'off', 'again', 'also', 'like', 'know', 'think', 'sure', 'go',
])

/**
 * Words that mark a term as something an article answers rather than something
 * a service or product page sells.
 *
 * Every entry has to be a word no business would use to name what it does.
 * "store", "fix", "care", "work" and "clean" all read as question words and are
 * all trade nouns — a liquor store and a business called Fix 'N Care would have
 * their own trade classed as a question, and the post named after it. They are
 * left out, and nothing is lost: the questions that would have used them
 * ("how to store", "how to clean") are already carried by "how".
 *
 * This is the whole gate on the feature. "dryer repair richmond" is a location
 * page and belongs to the generator above; "how long does dryer repair take" is
 * an article, and no amount of location pages will ever answer it. Publishing a
 * blog post against the first kind splits the signal of the page that already
 * targets it, which is worse than publishing nothing.
 */
const INFORMATIONAL = new Set([
  'how', 'why', 'when', 'what', 'which', 'whether', 'should', 'can', 'does', 'do',
  'is', 'are', 'cost', 'costs', 'price', 'prices', 'pricing', 'cheap', 'cheaper',
  'cheapest', 'expensive', 'worth', 'vs', 'versus', 'compare', 'comparison',
  'difference', 'better', 'guide', 'tips', 'checklist', 'mistakes', 'signs',
  'symptoms', 'causes', 'diy', 'yourself', 'long', 'often', 'choose', 'choosing',
  'storing', 'maintain', 'safe', 'safety', 'legal', 'permit', 'insurance',
  'warranty', 'guarantee', 'returns', 'refund', 'take', 'takes',
])
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

/**
 * The words that name this client and its places, and so say nothing about a
 * topic.
 *
 * Places are stripped outright: "dryer repair richmond" and "dryer repair
 * chesterfield" are one article, and one post per town is how a site ends up
 * with forty pages saying the same thing. The town belongs on the location
 * page.
 *
 * Brand words are stripped too, but never at the cost of a word the business
 * actually sells. "Fix 'N Care Appliance Repair" would otherwise take "repair"
 * out of every term it has — leaving "dryer" and "oven" with nothing in common,
 * so every appliance became its own post and the trade word vanished from every
 * headline. A word in the offerings or the trade is a topic word first.
 */
function vocabulary(client: Client, locations: ClientLocation[]) {
  const collect = (values: string[]) => {
    const out = new Set<string>()
    for (const v of values) for (const w of words(v)) if (w.length > 1) out.add(w)
    return out
  }

  const places = collect(locations.flatMap((l) => [l.name, l.region, l.metro]))
  for (const l of locations) {
    const abbr = normaliseState(l.region || '')
    if (abbr) places.add(abbr.toLowerCase())
  }

  const trade = deriveTrade(client)
  const topic = collect([...client.offerings, trade ?? ''])

  const brand = collect([
    client.name,
    ...client.aliases,
    client.domain.replace(/\.[a-z.]+$/, '').replace(/[-.]/g, ' '),
  ])
  // A place is a place even when it also appears in the offerings list.
  for (const w of topic) if (!places.has(w)) brand.delete(w)

  return { places, brand, noise: new Set([...places, ...brand]) }
}

/**
 * The term with the client's own name and towns taken out, tidied back into
 * something a person would read as a headline.
 *
 * Removing words leaves wreckage — a dangling "in", a comma before the question
 * mark, "a oven" where the town used to make the sentence scan. All of it shows
 * up in an <h1> on somebody's live site, so it is cleaned here rather than left
 * for whoever pastes the post.
 */
function displayText(text: string, noise: Set<string>): string {
  const PREPOSITION = /^(in|at|near|from|around|across|for|to|of|serving|throughout)$/i

  const tokens = text.trim().split(/\s+/)
  const kept: string[] = []
  for (const token of tokens) {
    const bare = token.toLowerCase().replace(/[^a-z0-9'-]/g, '')
    if (bare.length > 0 && noise.has(bare)) {
      /**
       * The word goes; the punctuation attached to it stays. "…today in
       * Richmond Virginia?" ends on the town, and dropping the token whole
       * takes the question mark with it — leaving a headline that asks a
       * question without looking like one.
       */
      const tail = /[?.!,;:]+$/.exec(token)
      if (tail && kept.length > 0) kept[kept.length - 1] += tail[0]
      /**
       * The preposition that pointed at the town goes with it, wherever it sat
       * in the sentence. "companies in Richmond Virginia have the best reviews"
       * left alone becomes "companies in have the best reviews", which is what
       * would appear in an <h1> on somebody's live website.
       */
      const last = kept[kept.length - 1]
      if (last && PREPOSITION.test(last.replace(/[^A-Za-z]/g, ''))) {
        // The stranded preposition goes too, but not the punctuation it just
        // inherited from the word that was removed before it.
        const carried = /[?.!,;:]+$/.exec(last)
        kept.pop()
        if (carried && kept.length > 0) kept[kept.length - 1] += carried[0]
      }
      continue
    }
    kept.push(token)
  }

  const tidied = kept
    .join(' ')
    .replace(/\s*,\s*(?=[?.!]|$)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([?.,!])/g, '$1')
    // "a oven" only scanned while the town was in the way.
    .replace(/\b([Aa])\s+(?=[aeiou])/g, (_m, a: string) => `${a}n `)
    .trim()
    .replace(/^[,;:\-\s]+/, '')

  return tidied.charAt(0).toUpperCase() + tidied.slice(1)
}

const stemOf = (text: string, noise: Set<string>) =>
  words(text).filter((w) => w.length > 1 && !STOP_WORDS.has(w) && !noise.has(w))

/** Whether a term is asking a question rather than naming something to buy. */
export const isInformational = (text: string) =>
  /\?/.test(text) || words(text).some((w) => INFORMATIONAL.has(w))

/**
 * The questions a business is asked about what it does, derived from its own
 * offerings.
 *
 * The floor under the pool, for a client with no Search Console property and no
 * run behind it. Split by whether customers come to the business or it goes to
 * them, because the two are asked different things: nobody asks how long it
 * takes to repair a bottle of tequila, and nobody asks how to store a boiler
 * service.
 */
function derivedSeeds(client: Client, places: Set<string>): string[] {
  const trade = deriveTrade(client)
  if (!trade) return []

  const visit = client.businessType !== 'local_service' || isVisitTrade(trade)
  const out: string[] = []

  for (const offering of client.offerings.slice(0, 10)) {
    /**
     * Detection puts the occasional wrong thing in the offerings list — a town
     * that reads like a service, a heading that kept its numbering. A seed
     * built on one of those produces a post asking what it costs to repair a
     * place name, so anything that is not plainly a thing the business sells is
     * skipped rather than cleaned up and guessed at.
     */
    if (/\d/.test(offering)) continue
    const { thing, action } = splitOffering(offering)
    if (thing.length < 3) continue
    if (words(thing).every((w) => places.has(w))) continue

    if (visit) {
      out.push(`how much does ${thing} cost`)
      out.push(`what to look for when choosing ${thing}`)
      out.push(`how to store ${thing}`)
    } else {
      const verb = action ?? 'service'
      out.push(`how much does ${thing} ${verb} cost`)
      out.push(`how long does ${thing} ${verb} take`)
      out.push(`signs your ${thing} needs ${verb}`)
      // Only a repair trade faces the repair-or-replace question. Asking it of a
      // lawn or a haircut is the same failure as asking a shop how long its
      // tequila takes to fix.
      if (action === 'repair' || action === 'repairs') {
        out.push(`is it worth repairing a ${thing} or replacing it`)
      }
    }
  }

  /**
   * "What to ask before buying liquor store" is what naming a shop after the
   * thing it sells produces. A trade you walk into is something you buy FROM;
   * a trade that comes to you is something you book.
   */
  out.push(
    visit ? `what to ask before buying from a ${trade}` : `what to ask before booking ${trade}`,
  )
  return out
}

/** Search Console first, then the question set, then what we derived ourselves. */
function pool(input: {
  client: Client
  locations: ClientLocation[]
  searchQueries: SearchQueryRow[]
  prompts: PromptRow[]
}): Keyword[] {
  const { client, locations, searchQueries, prompts } = input
  const { places, noise } = vocabulary(client, locations)
  const out: Keyword[] = []
  const seen = new Set<string>()

  const push = (text: string, source: KeywordSource, extra: Partial<Keyword> = {}) => {
    const clean = text.trim().replace(/\s+/g, ' ')
    if (clean.length < 8) return
    const key = clean.toLowerCase()
    if (seen.has(key)) return
    const stem = stemOf(clean, noise)
    // A term that is nothing but the client's own name and a town says nothing
    // about a topic, and two of them would cluster with each other.
    if (stem.length === 0) return
    const display = displayText(clean, noise)
    if (display.length < 8) return
    seen.add(key)
    out.push({
      text: clean,
      source,
      impressions: 0,
      clicks: 0,
      position: null,
      stem,
      display,
      ...extra,
    })
  }

  for (const q of searchQueries) {
    push(q.query, 'search_console', {
      impressions: q.impressions,
      clicks: q.clicks,
      position: q.position,
    })
  }
  for (const p of prompts) {
    if (MEASUREMENT_ONLY.has(p.intent)) continue
    push(p.text, 'question_set')
  }
  for (const seed of derivedSeeds(client, places)) push(seed, 'offering')

  return out
}

/**
 * Weight for ranking. Impressions are the only real evidence of demand, so a
 * measured term outranks an unmeasured one at every volume; the small floors
 * below only order the terms that carry no measurement at all.
 */
/**
 * Question-set intents that exist to measure the client, not to be answered by
 * it.
 *
 * "Best appliance repair company in Richmond" and "Is <brand> any good?" are how
 * we find out whether the engines name this business. They are not articles the
 * business writes: the first is a page arguing that it is the best, which the
 * research measures as neutral-to-negative, and the second is a post reviewing
 * itself. Both stay in the measurement, and neither becomes a post.
 */
const MEASUREMENT_ONLY = new Set(['comparison', 'brand'])

const weightOf = (k: Keyword) =>
  k.source === 'search_console' ? 100 + k.impressions : k.source === 'question_set' ? 2 : 1

/** How much two terms are about the same thing. */
function overlap(a: string[], b: string[]): number {
  const setB = new Set(b)
  const shared = a.filter((w) => setB.has(w)).length
  return shared === 0 ? 0 : shared / Math.min(a.length, b.length)
}

/**
 * Groups the pool into topics, one post each.
 *
 * Greedy and heaviest-first, so the term with the most real impressions names
 * the cluster and everything close to it is absorbed into the same article.
 * Writing one post per keyword is how a site ends up with forty pages saying
 * the same thing, which is the failure this grouping exists to prevent.
 */
export function clusterKeywords(keywords: Keyword[]): KeywordCluster[] {
  const ranked = [...keywords].sort((a, b) => weightOf(b) - weightOf(a))
  const clusters: KeywordCluster[] = []

  for (const k of ranked) {
    const home = clusters.find(
      (c) => overlap(k.stem, c.stem) >= 0.6 || k.stem.filter((w) => c.stem.includes(w)).length >= 2,
    )
    if (home) {
      home.keywords.push(k)
      home.impressions += k.impressions
      home.clicks += k.clicks
      if (k.source === 'search_console') {
        home.measured = true
        if (k.position !== null && (home.bestPosition === null || k.position < home.bestPosition)) {
          home.bestPosition = k.position
        }
      }
      continue
    }
    clusters.push({
      topic: k.display,
      keywords: [k],
      stem: k.stem,
      impressions: k.impressions,
      clicks: k.clicks,
      measured: k.source === 'search_console',
      bestPosition: k.source === 'search_console' ? k.position : null,
    })
  }

  for (const c of clusters) c.topic = topicCandidates(c)[0].display

  return clusters.sort((a, b) => b.impressions - a.impressions || b.keywords.length - a.keywords.length)
}

/**
 * What to call a cluster, once its membership is settled.
 *
 * The heaviest term is the wrong answer often enough to matter: a cluster held
 * together by "how much does microwave repair cost" is frequently topped by
 * "microwave repair Glen Allen VA", because a location query is asked more. A
 * post named after that competes with the location page rather than answering
 * anything, so the name comes from the best question in the cluster and the
 * location query stays in it only as evidence of demand.
 */
export function topicCandidates(cluster: KeywordCluster): Keyword[] {
  /**
   * Never a superlative in a headline. The GEO research measures "best",
   * "leading" and the rest as neutral-to-negative for AI visibility, and every
   * other generator here strips them out of copy — a post titled with one would
   * be this module publishing the thing it tells clients to stop doing.
   */
  const asking = cluster.keywords.filter(
    (k) => isInformational(k.text) && !SUPERLATIVE_PATTERN.test(k.display),
  )
  const measured = asking.filter((k) => k.source === 'search_console')
  const ranked = [...measured, ...asking.filter((k) => k.source !== 'search_console')]
  return ranked.length > 0 ? ranked : cluster.keywords.slice(0, 1)
}

/**
 * The question a candidate is asking, with the subject taken out.
 *
 * "How long does oven repair take" and "how long does dishwasher repair take"
 * share an angle; "signs your oven needs repair" does not. Used to stop one
 * question shape from filling the whole set — a client handed six posts that
 * differ only in the appliance has been handed a template, not a plan.
 */
export const angleOf = (k: Keyword) =>
  k.stem.filter((w) => isInformational(w)).sort().join('|')

/**
 * Every topic worth an article, ranked.
 *
 * Only clusters with at least one informational term survive. A cluster made
 * entirely of "<service> <town>" queries is a location page, and the generator
 * above already owns it.
 */
export function keywordTopics(input: {
  client: Client
  locations: ClientLocation[]
  searchQueries: SearchQueryRow[]
  prompts: PromptRow[]
}): KeywordCluster[] {
  return clusterKeywords(pool(input)).filter((c) => c.keywords.some((k) => isInformational(k.text)))
}
