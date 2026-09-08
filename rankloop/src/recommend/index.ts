import type { Recommendation, RecommendInput } from './types'
import { countPlaceholders } from './types'
import { recommendMeta } from './meta'
import { recommendCopy } from './copy'
import { recommendSchema } from './schema'
import { recommendNewPages } from './newpages'
import { recommendBlogPosts } from './blog'

export type { Recommendation, RecommendInput, PromptRow, SearchQueryRow } from './types'
export { countPlaceholders } from './types'

/**
 * Everything the tool proposes changing, ranked by measured impact.
 *
 * Deliberately never touches design, layout, or anything visual — only words,
 * metadata, structured data, and pages that do not exist yet.
 */
export function buildRecommendations(input: RecommendInput): Recommendation[] {
  /**
   * The pages a business needs to exist at all come first, and the posts are
   * built knowing what they took. A post about "<trade> in <town>" published
   * beside the location page for that town splits the exact signal that page
   * exists to concentrate.
   */
  const newPages = recommendNewPages(input)
  const claimed = new Set(newPages.map((r) => r.target.toLowerCase()))

  return [
    ...newPages,
    ...recommendBlogPosts(input, claimed),
    ...recommendCopy(input),
    ...recommendMeta(input),
    ...recommendSchema(input),
  ].sort((a, b) => b.priority - a.priority)
}

export function summarise(recs: Recommendation[]) {
  const byKind = new Map<string, number>()
  for (const r of recs) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1)
  return {
    total: recs.length,
    byKind: [...byKind.entries()].sort((a, b) => b[1] - a[1]),
    placeholders: recs.reduce((n, r) => n + countPlaceholders(r.proposedValue), 0),
    needingInput: recs.filter((r) => countPlaceholders(r.proposedValue) > 0).length,
  }
}
