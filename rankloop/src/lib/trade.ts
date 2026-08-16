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

const ACTIONS = [
  'repair', 'repairs', 'installation', 'service', 'servicing', 'cleaning',
  'replacement', 'removal', 'maintenance', 'fitting', 'plumbing', 'roofing',
]

export function splitOffering(offering: string): { thing: string; action: string | null } {
  const words = offering.trim().toLowerCase().split(/\s+/)
  const last = words[words.length - 1]
  if (words.length > 1 && ACTIONS.includes(last)) {
    return { thing: words.slice(0, -1).join(' '), action: last }
  }
  return { thing: words.join(' '), action: null }
}

export function deriveTrade(client: Client): string {
  const offerings = client.offerings.map(splitOffering)
  const things = [...new Set(offerings.map((o) => o.thing))].filter((t) => t.length > 2)
  const action = offerings.find((o) => o.action)?.action ?? 'service'

  const name = client.name.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const words = name.split(' ')

  const actionIndex = words.lastIndexOf(action)
  if (actionIndex > 0) {
    const category = words[actionIndex - 1]
    // Guard against the trade word being part of the brand ("Care Repair").
    if (category.length > 3 && !things.includes(category)) return `${category} ${action}`
  }

  if (things.length > 1) {
    const shared = things[0]
      .split(' ')
      .find((w) => w.length > 3 && things.every((t) => t.includes(w)))
    if (shared) return `${shared} ${action}`
  }

  if (things.length === 1) return `${things[0]} ${action}`
  return client.offerings[0] ?? action
}
