/**
 * US states. This is reference data about the world, not about any client —
 * the same list is correct for every business the tool will ever see.
 *
 * It exists so geography can be worked out from a site's own text: a page that
 * says "Katy, TX" tells us the site targets Texas, without anyone hardcoding
 * "katy" anywhere.
 */
export const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
}

export const STATE_ABBREVIATIONS = new Set(Object.values(US_STATES))

/** "TX" -> "Texas". Returns null for anything that is not a state code. */
export function stateFromAbbreviation(abbr: string): string | null {
  const upper = abbr.toUpperCase()
  const entry = Object.entries(US_STATES).find(([, a]) => a === upper)
  if (!entry) return null
  return entry[0].replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Accepts either a full name or an abbreviation and returns the abbreviation. */
export function normaliseState(input: string): string | null {
  const lower = input.toLowerCase().trim()
  if (US_STATES[lower]) return US_STATES[lower]
  const upper = input.toUpperCase().trim()
  return STATE_ABBREVIATIONS.has(upper) ? upper : null
}

/**
 * Reads a typed place that may carry its own state: "Virginia Beach VA".
 *
 * A business with branches in two states cannot be described by a single state,
 * and the towns are typed as one comma-separated list, so the state rides on the
 * entry rather than on the list. An entry with no state falls back to the first
 * state served, which is what a single-state client always wants.
 *
 * The state is read from the LAST word (or two, for "New York") so that place
 * names containing a state word survive: "Kansas City Kansas" is Kansas City in
 * KS, and "Virginia Beach" with no state is a place, not a state.
 */
export function parseTypedPlace(raw: string, fallbackState: string): { name: string; state: string } {
  const trimmed = raw.trim().replace(/\s+/g, ' ')

  for (const words of [2, 1]) {
    const parts = trimmed.split(' ')
    if (parts.length <= words) continue
    const tail = parts.slice(-words).join(' ')
    const state = normaliseState(tail)
    const name = parts.slice(0, -words).join(' ').replace(/,\s*$/, '').trim()
    if (state && name) return { name, state }
  }

  return { name: trimmed.replace(/,\s*$/, ''), state: fallbackState }
}

/**
 * Every state as a pickable option, alphabetically by name.
 *
 * The interface offers this list rather than a text box because a mistyped
 * state is not a typo — it silently changes which place names count as
 * wrong-geography, and therefore every finding that follows.
 */
export const US_STATE_OPTIONS: { abbr: string; name: string }[] = Object.entries(US_STATES)
  .map(([name, abbr]) => ({ abbr, name: name.replace(/\b\w/g, (c) => c.toUpperCase()) }))
  .sort((a, b) => a.name.localeCompare(b.name))
