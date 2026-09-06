import type { Client } from './client'

/**
 * What a business does, in the words a customer would use — "appliance repair",
 * not bare "repair" and not just its first service.
 *
 * The category noun is the hard part. A site listing "refrigerator repair,
 * freezer repair, dryer repair" shares no noun across its services, yet its own
 * NAME almost always ends with the trade ("… Appliance Repair", "… Plumbing
 * Services"). Reading it off the end of the name generalises to any industry
 * without a lookup table, and falls back safely when the name carries no trade.
 *
 * Shared by prompt generation and the recommendations engine so a client is
 * described identically in the questions we ask and the pages we propose.
 */

export const ACTIONS = [
  'repair', 'repairs', 'installation', 'service', 'servicing', 'cleaning',
  'replacement', 'removal', 'maintenance', 'fitting', 'plumbing', 'roofing',
]

/**
 * Trade nouns for a business people come to rather than call out. A liquor
 * store, a bakery and a garden centre all name themselves this way, and the
 * word before it is the category — which is what a customer types.
 */
export const PLACE_NOUNS = ['store', 'shop', 'market', 'boutique', 'centre', 'center', 'bakery', 'pharmacy', 'salon']

export function splitOffering(offering: string): { thing: string; action: string | null } {
  const words = offering.trim().toLowerCase().split(/\s+/)
  const last = words[words.length - 1]
  if (words.length > 1 && ACTIONS.includes(last)) {
    return { thing: words.slice(0, -1).join(' '), action: last }
  }
  return { thing: words.join(' '), action: null }
}

/**
 * Returns null when the site gave us nothing to name the trade with.
 *
 * The old fallback was the bare word "service", which reads as a real noun and
 * so travels silently into every question we ask and every page we propose —
 * "emergency service", "a normal call-out fee for service". A business that
 * sells bottles is not in the service trade, and a measurement taken with that
 * word in the question measures nothing. Refusing is the honest answer;
 * generation stops and the operator is told why.
 */
/**
 * Whether the trade is a place customers come to rather than a job someone is
 * sent out on. The two need opposite wording on a page: "call to book, we will
 * confirm a price before any work starts" is nonsense addressed to someone who
 * is going to walk in and buy a bottle.
 */
export function isVisitTrade(trade: string): boolean {
  return PLACE_NOUNS.includes(trade.trim().toLowerCase().split(/\s+/).pop() ?? '')
}

export function deriveTrade(client: Client): string | null {
  const offerings = client.offerings.map(splitOffering)
  const things = [...new Set(offerings.map((o) => o.thing))].filter((t) => t.length > 2)
  const action = offerings.find((o) => o.action)?.action ?? null

  const name = client.name.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const words = name.split(' ')

  /**
   * The trade off the end of the business's own name — "… Appliance Repair",
   * "… Liquor Store". When the offerings carry no verb, the name is the only
   * place the category noun exists.
   */
  const nameTrade = action ?? words.find((w) => [...ACTIONS, ...PLACE_NOUNS].includes(w)) ?? null
  if (nameTrade) {
    const at = words.lastIndexOf(nameTrade)
    if (at > 0) {
      const category = words[at - 1]
      // Guard against the trade word being part of the brand ("Care Repair").
      if (category.length > 3 && !things.includes(category)) return `${category} ${nameTrade}`
    }
  }

  if (action) {
    if (things.length > 1) {
      const shared = things[0]
        .split(' ')
        .find((w) => w.length > 3 && things.every((t) => t.includes(w)))
      if (shared) return `${shared} ${action}`
    }
    if (things.length === 1) return `${things[0]} ${action}`
  }

  return client.offerings[0] ?? null
}
