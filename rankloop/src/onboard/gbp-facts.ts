import type { GbpReading } from './gbp'

/**
 * The questionnaire answers a Google listing can fill in on its own.
 *
 * The listing is the one place a business has already written some of this
 * down, so asking an operator to copy it across by hand is asking them to
 * retype what the tool just read. Everything here is a straight transcription
 * of something on the listing — never an inference from the category, the
 * rating or the trade.
 *
 * Two rules hold this to the same standard as the rest of the tool:
 *
 *  - Nothing is filled from a listing that was not actually opened. A share
 *    link that only yielded a name tells us nothing about opening hours, and
 *    an empty box is the honest representation of that.
 *  - Every filled answer is labelled in the interface as having come from
 *    Google, in a field the operator can overwrite. A prefilled box nobody is
 *    told about is a box nobody checks.
 */

export type PrefilledFacts = {
  /** Question key to answer. */
  answers: Record<string, string>
  /** Question key to where it came from, shown beside the field. */
  sources: Record<string, string>
}

const FROM_GOOGLE = 'read off the Google listing'

/**
 * Splits a Maps address into the street line and the postal code.
 *
 * "3370 Shaver St, Pasadena, TX 77504" is the shape Maps writes, and the two
 * halves go to different questions. A one-part address is not split: a listing
 * that says only "Pasadena, TX" has no street line, and putting the town in a
 * box labelled "street address" would publish it as one in structured data.
 */
export function splitAddress(address: string): { street: string | null; postalCode: string | null } {
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const postalCode = address.match(/\b(\d{5})(?:-\d{4})?\b\s*$/)?.[1] ?? null
  const street = parts.length >= 3 && !/^\d{5}/.test(parts[0]) ? parts[0] : null
  return { street, postalCode }
}

export function factsFromProfile(gbp: GbpReading | null): PrefilledFacts {
  const answers: Record<string, string> = {}
  const sources: Record<string, string> = {}

  // Nothing is transcribed from a listing that was never opened.
  if (!gbp || !gbp.readListing) return { answers, sources }

  const fill = (key: string, value: string | null | undefined) => {
    const trimmed = value?.trim()
    if (!trimmed) return
    answers[key] = trimmed
    sources[key] = FROM_GOOGLE
  }

  if (gbp.address) {
    const { street, postalCode } = splitAddress(gbp.address)
    fill('street_address', street)
    fill('postal_code', postalCode)
  }

  // Only ever a complete week — gbp.ts refuses to hand over a partial one.
  fill('opening_hours', gbp.hours)

  // Maps writes the bracket exactly as the questionnaire stores it.
  if (gbp.priceLevel && /^\$+$/.test(gbp.priceLevel) && gbp.priceLevel.length <= 4) {
    fill('price_band', gbp.priceLevel)
  }

  return { answers, sources }
}
