import type { Client } from '../lib/client'
import { deriveTrade, splitOffering } from '../lib/trade'

/**
 * Whether a phrase Google showed is about what this business does.
 *
 * Google's "People also ask" and related searches drift. A search about a
 * broken freezer in a city also raises "What is the non-emergency line in
 * Richmond?", and a blog post or FAQ built on that is noise on a client's
 * site. So a phrase has to share a word with the business's own trade or
 * offerings — nouns that arrive on the client record, never from a list here.
 */
const GENERIC = new Set(['service', 'services', 'repair', 'repairs', 'store', 'shop', 'company', 'near', 'best'])

export function topicWords(client: Client): Set<string> {
  const out = new Set<string>()
  const add = (s: string) => {
    for (const w of s.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length < 3) continue
      out.add(w)
      // "appliances" and "appliance", "refrigerators" and "refrigerator".
      if (w.endsWith('s')) out.add(w.slice(0, -1))
      else out.add(`${w}s`)
    }
  }
  const trade = deriveTrade(client)
  if (trade) add(trade)
  for (const o of client.offerings) add(splitOffering(o).thing)
  return out
}

export function isOnTopic(phrase: string, words: Set<string>): boolean {
  const tokens = phrase.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3)
  const specific = [...words].filter((w) => !GENERIC.has(w))
  // A client whose only topic words are generic ones cannot filter anything honestly.
  if (specific.length === 0) return true
  return tokens.some((t) => words.has(t) && !GENERIC.has(t))
}

/**
 * A search for one particular business or address rather than a topic:
 * "richmond appliance guys", "5418 lakeside ave". Real demand, but demand for
 * somebody else — never a page for this client to write.
 */
export function isNavigational(phrase: string, businessNames: string[]): boolean {
  const lower = phrase.toLowerCase()
  if (/\b\d{3,}\b/.test(lower)) return true
  return businessNames.some((name) => {
    const distinctive = name
      .toLowerCase()
      .replace(/\b(inc|llc|l\.l\.c|co|ltd|of|the|and|&)\b/g, ' ')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
    if (distinctive.length < 2) return false
    return distinctive.filter((w) => lower.includes(w)).length >= Math.min(distinctive.length, 3)
  })
}
