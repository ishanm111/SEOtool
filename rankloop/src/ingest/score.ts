/**
 * Superlative padding. The GEO research found this is neutral-to-negative for
 * AI visibility, which is the opposite of what most SEO copy assumes.
 */
const SUPERLATIVES = [
  'best', 'top-rated', 'top rated', '#1', 'number one', 'premier', 'leading',
  'finest', 'unbeatable', 'unmatched', 'world-class', 'world class', 'greatest',
  'most trusted', 'superior', 'ultimate', 'exceptional', 'outstanding',
  'second to none', 'unrivaled', 'unparalleled', 'the very best',
]

/**
 * Concrete numbers: percentages, money, years, counts, ratings, durations.
 * Adding these was the single biggest measured lever in the GEO paper (+40%).
 */
const STAT_PATTERNS = [
  /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s?%/g,
  /\$\s?\d[\d,]*(?:\.\d{2})?/g,
  /\b(?:19|20)\d{2}\b/g,
  /\b\d+(?:\.\d+)?\s?(?:star|stars|reviews?|customers?|years?|months?|days?|hours?|minutes?|technicians?|brands?|models?)\b/gi,
  /\b(?:over|more than|under|less than|up to|within)\s+\d[\d,]*/gi,
  /\b\d+\s?\/\s?\d+\b/g,
]

export function countStats(text: string): number {
  let n = 0
  for (const re of STAT_PATTERNS) n += (text.match(re) ?? []).length
  return n
}

export function countSuperlatives(text: string): number {
  const lower = text.toLowerCase()
  let n = 0
  for (const s of SUPERLATIVES) {
    const re = new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
    n += (lower.match(re) ?? []).length
  }
  return n
}

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (w.length <= 3) return 1
  const groups = w
    .replace(/(?:es|ed|[^aeiouy]e)$/, '')
    .match(/[aeiouy]{1,2}/g)
  return Math.max(1, groups?.length ?? 1)
}

/**
 * Flesch reading ease, 0-100. Higher is easier. The GEO paper measured a
 * 15-30% visibility gain from readability alone. Aim for 60+.
 */
export function readingEase(text: string): number {
  const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length)
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return 0
  const syl = words.reduce((sum, w) => sum + syllables(w), 0)
  const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syl / words.length)
  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/**
 * Counts references to places the business does not actually serve.
 *
 * The term list is derived per client during onboarding — never hardcoded — so
 * this works for any site built for the wrong area. Place names that exist in
 * more than one state are excluded upstream when they appear in the real
 * service area, which prevents false positives.
 */
export function auditGeo(haystack: string, wrongGeoTerms: string[]): { hits: number; terms: string[] } {
  const lower = haystack.toLowerCase()
  const found = new Map<string, number>()
  for (const term of wrongGeoTerms) {
    let count = 0
    let idx = lower.indexOf(term)
    while (idx !== -1) {
      count++
      idx = lower.indexOf(term, idx + term.length)
    }
    if (count > 0) found.set(term, count)
  }
  return {
    hits: [...found.values()].reduce((a, b) => a + b, 0),
    terms: [...found.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `${t} (${c})`),
  }
}
