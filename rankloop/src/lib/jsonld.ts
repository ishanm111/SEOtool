import * as cheerio from 'cheerio'
import { normaliseState } from '../onboard/us-states'

/**
 * Reads the facts a site publishes about itself in JSON-LD.
 *
 * A growing share of sites render their copy in the browser: the HTML that
 * arrives is an empty `<div id="root">`, and every word a customer reads is
 * assembled by JavaScript afterwards. Reading only the served text finds nothing
 * on those sites — no phone, no service area, no products — and the tool then
 * reports the blank it created as if it had measured it.
 *
 * The structured data is still in the served HTML, and it is the most reliable
 * statement of fact a site publishes: the business authored it for machines.
 * Everything here is read off the page. Nothing is inferred or invented.
 */

export type JsonLdNode = Record<string, unknown>

export type JsonLdPlace = { name: string; state: string | null }

export type JsonLdSignals = {
  phones: string[]
  places: JsonLdPlace[]
  /** Categories and product names the site says it sells, lowercased. */
  offerings: string[]
  faqs: { question: string; answer: string }[]
  descriptions: string[]
  /** The business's own street address, when it publishes one. */
  locality: string | null
  region: string | null
}

export function parseJsonLd(html: string): JsonLdNode[] {
  const $ = cheerio.load(html)
  const nodes: JsonLdNode[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const walk = (node: unknown) => {
        if (Array.isArray(node)) return node.forEach(walk)
        if (node && typeof node === 'object') {
          nodes.push(node as JsonLdNode)
          Object.values(node as JsonLdNode).forEach(walk)
        }
      }
      walk(JSON.parse($(el).contents().text()))
    } catch {
      // malformed JSON-LD is common in the wild
    }
  })
  return nodes
}

export function schemaTypesOf(nodes: JsonLdNode[]): string[] {
  const types = new Set<string>()
  for (const n of nodes) {
    const t = n['@type']
    if (typeof t === 'string') types.add(t)
    else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x))
  }
  return [...types].sort()
}

const typeOf = (n: JsonLdNode): string[] => {
  const t = n['@type']
  if (typeof t === 'string') return [t]
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string')
  return []
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Same shape the text scraper produces, so the two sources merge cleanly. */
function prettyPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  if (digits.length !== 10) return null
  if (/^(\d)\1{9}$/.test(digits)) return null
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}

/**
 * Offering names as a customer would say them.
 *
 * Merchandising labels join categories with an ampersand or a slash — "Tequila
 * & Mezcal", "Vodka, Rum & Spirits". Nobody searches for the joined string, so
 * it is split back into the categories it was built from.
 */
function splitCategoryLabel(label: string): string[] {
  return label
    .toLowerCase()
    .split(/\s*(?:&|,|\/|\band\b)\s*/)
    .map((s) => s.replace(/[^a-z0-9\s'-]/g, '').trim())
    .filter((s) => s.length > 2 && s.length < 40)
    /**
     * Merchandising wrappers, not categories. The root of a catalogue is named
     * for the shop window — "Premium Spirits Collection", "Our Featured Range" —
     * and nobody has ever typed one into an AI assistant.
     */
    .filter((s) => !/\b(?:collection|selection|catalog|catalogue|range|featured|our|all)\b/.test(s))
}

export function jsonLdSignals(nodes: JsonLdNode[]): JsonLdSignals {
  const phones = new Set<string>()
  const places: JsonLdPlace[] = []
  const offerings: string[] = []
  const faqs: { question: string; answer: string }[] = []
  const descriptions: string[] = []
  let locality: string | null = null
  let region: string | null = null

  const addPlace = (name: string | null, state: string | null) => {
    if (!name || name.length < 3) return
    const key = name.toLowerCase()
    const existing = places.find((p) => p.name.toLowerCase() === key)
    if (existing) {
      if (!existing.state && state) existing.state = state
      return
    }
    places.push({ name, state })
  }

  for (const node of nodes) {
    const types = typeOf(node)

    const tel = str(node.telephone)
    if (tel) {
      const p = prettyPhone(tel)
      if (p) phones.add(p)
    }

    if (types.includes('PostalAddress')) {
      const city = str(node.addressLocality)
      const st = normaliseState(str(node.addressRegion) ?? '')
      if (city) {
        locality ??= city
        region ??= st
        addPlace(city, st)
      }
    }

    /**
     * areaServed entries are the business's own statement of where it trades.
     * A `State` node is skipped: it is the region a town sits in, not a place a
     * customer searches for, and adding it produces a location page for "Texas".
     */
    if (types.some((t) => /^(?:City|AdministrativeArea|Place)$/.test(t))) {
      const name = str(node.name)
      const parent = node.containedInPlace
      const parentName =
        parent && typeof parent === 'object' ? str((parent as JsonLdNode).name) : null
      if (name && !normaliseState(name)) addPlace(name, normaliseState(parentName ?? ''))
    }

    if (types.includes('OfferCatalog') || types.includes('Product')) {
      const name = str(node.name)
      if (name) {
        offerings.push(...(types.includes('OfferCatalog') ? splitCategoryLabel(name) : [name.toLowerCase()]))
      }
    }

    if (types.includes('Question')) {
      const q = str(node.name)
      const accepted = node.acceptedAnswer
      const a =
        accepted && typeof accepted === 'object' ? str((accepted as JsonLdNode).text) : null
      if (q && a) faqs.push({ question: q, answer: a })
    }

    const desc = str(node.description)
    if (desc && desc.length > 40 && !descriptions.includes(desc)) descriptions.push(desc)
  }

  // Places inherit the business's own state when the markup leaves it implicit —
  // "areaServed: Houston" on a Texas business means Houston TX.
  for (const p of places) p.state ??= region

  return {
    phones: [...phones],
    places,
    offerings: [...new Set(offerings)],
    faqs,
    descriptions,
    locality,
    region,
  }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The structured data rewritten as ordinary page content.
 *
 * Used only when a page serves no readable text of its own. Scoring, findings
 * and recommendations all work on paragraphs; handing them the site's own
 * sentences from its JSON-LD is the difference between auditing the site and
 * auditing an empty string.
 */
export function schemaContentHtml(signals: JsonLdSignals): string {
  const parts: string[] = []

  for (const d of signals.descriptions) parts.push(`<p>${esc(d)}</p>`)

  if (signals.offerings.length > 0) {
    parts.push(`<h2>What this business offers</h2>`)
    parts.push(`<p>${esc(signals.offerings.join(', '))}</p>`)
  }

  if (signals.faqs.length > 0) {
    parts.push('<h2>Frequently asked questions</h2>')
    for (const f of signals.faqs) {
      parts.push(`<h3>${esc(f.question)}</h3><p>${esc(f.answer)}</p>`)
    }
  }

  if (signals.places.length > 0) {
    parts.push('<h2>Where this business trades</h2>')
    parts.push(`<p>${esc(signals.places.map((p) => (p.state ? `${p.name}, ${p.state}` : p.name)).join(', '))}</p>`)
  }

  return parts.join('\n')
}

/** Visible words a served page actually carries, ignoring markup and scripts. */
export function visibleWordCount(html: string): number {
  const $ = cheerio.load(html)
  $('script, style, noscript, svg').remove()
  return $.root().text().split(/\s+/).filter(Boolean).length
}
