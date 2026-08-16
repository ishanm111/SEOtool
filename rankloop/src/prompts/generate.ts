import type { Client, ClientLocation } from '../lib/client'
import { normaliseState } from '../onboard/us-states'
import { deriveTrade, splitOffering } from '../lib/trade'

/**
 * Writes the questions we ask the AI engines.
 *
 * These have to read like something a person would actually type. Keyword-shaped
 * strings ("appliance repair richmond va") do get used, but a real customer more
 * often writes a sentence about their problem — and the two retrieve different
 * sources, so both belong in the set.
 *
 * Nothing here names an industry or a place. Every noun comes from the client's
 * detected offerings and locations.
 */

export type GeneratedPrompt = {
  text: string
  locationName: string | null
  intent: string
  persona: 'general' | 'older'
  isCore: boolean
}

// ── shared helpers ──────────────────────────────────────────────────────────

/**
 * The right indefinite article. Generated questions are shown to a client and
 * asked verbatim of an AI engine, so "a appliance repair company" both reads as
 * machine-written and is not what a person would type.
 */
const article = (word: string) => (/^[aeiou]/i.test(word.trim()) ? 'an' : 'a')

/** Drops near-duplicates so the set does not waste asks on the same question. */
function dedupe(prompts: GeneratedPrompt[]): GeneratedPrompt[] {
  const seen = new Set<string>()
  return prompts.filter((p) => {
    const key = p.text.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── local service ───────────────────────────────────────────────────────────

/**
 * A local business is found through four kinds of question, and they behave very
 * differently: an emergency query converts immediately, a comparison query is
 * where the engine literally names a recommendation.
 *
 * The older-customer variants are deliberate. Older customers write longer,
 * conversational, trust-led questions ("someone reliable", "won't overcharge
 * me"), and those retrieve a measurably different set of sources.
 */
function localServicePrompts(client: Client, locations: ClientLocation[]): GeneratedPrompt[] {
  if (locations.length === 0) return []

  const offerings = client.offerings.map(splitOffering)
  const things = [...new Set(offerings.map((o) => o.thing))].filter((t) => t.length > 2)
  const action = offerings.find((o) => o.action)?.action ?? 'service'
  const trade = deriveTrade(client)

  const out: GeneratedPrompt[] = []
  const primary = locations[0]
  const secondary = locations.slice(1)

  /**
   * Two forms on purpose. In a sentence people write the state out ("I live in
   * Richmond Virginia"); in a keyword-style query they abbreviate it ("dryer
   * repair Richmond VA"). Both get typed, and they retrieve differently.
   */
  const where = (l: ClientLocation) => `${l.name}${l.region ? ` ${l.region}` : ''}`
  const whereShort = (l: ClientLocation) => {
    const abbr = normaliseState(l.region || '')
    return `${l.name}${abbr ? ` ${abbr}` : ''}`
  }

  // ── emergency: highest intent, someone acting right now
  const urgentThings = things.slice(0, 4)
  for (const [i, thing] of urgentThings.entries()) {
    const loc = locations[i % locations.length]
    out.push({
      text: `My ${thing} stopped working, who can come out today in ${where(loc)}?`,
      locationName: loc.name,
      intent: 'emergency',
      persona: 'general',
      isCore: i < 2,
    })
  }
  out.push({
    text: `Emergency ${trade} ${whereShort(primary)} same day service`,
    locationName: primary.name,
    intent: 'emergency',
    persona: 'general',
    isCore: true,
  })

  // ── comparison: where an engine actually says "I recommend X"
  out.push(
    {
      text: `Best ${trade} company in ${where(primary)}`,
      locationName: primary.name,
      intent: 'comparison',
      persona: 'general',
      isCore: true,
    },
    {
      text: `Most reliable ${trade} service in ${where(primary)}`,
      locationName: primary.name,
      intent: 'comparison',
      persona: 'general',
      isCore: true,
    },
  )
  for (const loc of secondary.slice(0, 4)) {
    out.push({
      text: `Recommend ${article(trade)} ${trade} company near ${where(loc)}`,
      locationName: loc.name,
      intent: 'comparison',
      persona: 'general',
      isCore: false,
    })
  }
  out.push({
    text: `Which ${trade} companies in ${where(primary)} have the best reviews?`,
    locationName: primary.name,
    intent: 'comparison',
    persona: 'general',
    isCore: false,
  })

  // ── price: asked of AI far more than of a search box
  for (const [i, thing] of things.slice(0, 3).entries()) {
    const loc = locations[i % locations.length]
    out.push({
      text: `How much does it cost to ${action} a ${thing} in ${where(loc)}?`,
      locationName: loc.name,
      intent: 'price',
      persona: 'general',
      isCore: i === 0,
    })
  }
  out.push({
    text: `What is a normal call-out fee for ${trade} in ${where(primary)}?`,
    locationName: primary.name,
    intent: 'price',
    persona: 'general',
    isCore: false,
  })

  // ── service-specific: easy to win, because most local sites stay generic
  for (const [i, thing] of things.slice(0, 6).entries()) {
    const loc = locations[i % locations.length]
    out.push({
      text: `${thing} ${action} ${whereShort(loc)}`,
      locationName: loc.name,
      intent: 'service',
      persona: 'general',
      isCore: i < 2,
    })
  }

  // ── older-customer phrasing: longer, conversational, trust-led
  const firstThing = things[0] ?? trade
  out.push(
    {
      text: `I need someone to come and look at my ${firstThing}, it has stopped working. I live in ${where(primary)}. Who should I call?`,
      locationName: primary.name,
      intent: 'emergency',
      persona: 'older',
      isCore: true,
    },
    {
      text: `I am not sure who to trust for ${trade} near ${where(primary)}. Can you recommend somebody reliable?`,
      locationName: primary.name,
      intent: 'comparison',
      persona: 'older',
      isCore: true,
    },
  )
  if (secondary[0]) {
    out.push({
      text: `I am looking for an honest ${trade} company in ${where(secondary[0])} that will not overcharge me.`,
      locationName: secondary[0].name,
      intent: 'comparison',
      persona: 'older',
      isCore: false,
    })
  }

  return out
}

// ── ecommerce ───────────────────────────────────────────────────────────────

/** Strips variant noise so a product title reads as a category a person would type. */
function productCategory(offering: string): string {
  return offering
    .replace(/\b(mens|womens|men|women|kids|unisex)\b/gi, '')
    .replace(/\s*-\s*.*$/, '')
    .replace(/\b(black|white|grey|gray|navy|blue|red|green|pink|onyx|natural|new|edition|low|high|mid)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A store is found through completely different questions to a local business.
 * There is no location, no map pack, and no "near me" — people ask which product
 * suits a purpose, how two compare, or where to buy one.
 *
 * Product pages rarely get cited for these. Comparison and guide content does,
 * which is why the generated set leans that way: it measures the gap the client
 * most likely has.
 */
function ecommercePrompts(client: Client): GeneratedPrompt[] {
  const categories = [
    ...new Set(client.offerings.map(productCategory).filter((c) => c.length > 3 && c.split(' ').length <= 4)),
  ]
  if (categories.length === 0) return []

  const top = categories.slice(0, 8)
  const brand = client.name
  const out: GeneratedPrompt[] = []

  for (const [i, cat] of top.entries()) {
    out.push({
      text: `Best ${cat} to buy online`,
      locationName: null,
      intent: 'discovery',
      persona: 'general',
      isCore: i < 3,
    })
  }

  for (const [i, cat] of top.slice(0, 4).entries()) {
    out.push({
      text: `Where can I buy good ${cat}?`,
      locationName: null,
      intent: 'where-to-buy',
      persona: 'general',
      isCore: i < 2,
    })
  }

  for (const [i, cat] of top.slice(0, 4).entries()) {
    out.push({
      text: `What should I look for when choosing ${cat}?`,
      locationName: null,
      intent: 'problem',
      persona: 'general',
      isCore: i < 2,
    })
  }

  for (const cat of top.slice(0, 3)) {
    out.push({
      text: `Most comfortable ${cat} for everyday wear`,
      locationName: null,
      intent: 'discovery',
      persona: 'general',
      isCore: false,
    })
  }

  // Brand questions: the clearest test of whether the engines know this store.
  out.push(
    {
      text: `Is ${brand} any good?`,
      locationName: null,
      intent: 'brand',
      persona: 'general',
      isCore: true,
    },
    {
      text: `${brand} reviews — is it worth buying from?`,
      locationName: null,
      intent: 'brand',
      persona: 'general',
      isCore: true,
    },
  )
  if (top[0]) {
    out.push({
      text: `${brand} vs other ${top[0]} brands`,
      locationName: null,
      intent: 'comparison',
      persona: 'general',
      isCore: true,
    })
  }

  for (const cat of top.slice(0, 3)) {
    out.push({
      text: `Best ${cat} under $100`,
      locationName: null,
      intent: 'price',
      persona: 'general',
      isCore: false,
    })
  }

  return out
}

// ── entry point ─────────────────────────────────────────────────────────────

export function generatePrompts(client: Client, locations: ClientLocation[]): GeneratedPrompt[] {
  const prompts =
    client.businessType === 'ecommerce'
      ? ecommercePrompts(client)
      : localServicePrompts(client, locations)

  return dedupe(prompts)
}
