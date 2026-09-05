import type { Client } from '../../lib/client'

/**
 * One page pulled from a client's site, whatever platform it runs on.
 *
 * Everything downstream — splitting, scoring, findings, recommendations — works
 * on this shape alone and never learns which platform produced it.
 */
export type IngestedPage = {
  /** The platform's own id: WordPress post id, Shopify product id, or null. */
  externalId: string | null
  url: string
  slug: string
  title: string
  metaDescription: string
  contentHtml: string
  schemaTypes: string[]
  pageType: 'page' | 'post' | 'product' | 'collection'
  /**
   * Words the served HTML actually carried, before any fallback. Adapters that
   * read a platform API leave this unset — their content never went through a
   * browser to begin with, so there is nothing to under-report.
   */
  renderedWordCount?: number
  /**
   * Where the content came from. `structured-data` means the page served no
   * readable copy and its own JSON-LD was read instead; the audit still has
   * something true to work on, and the report says so rather than presenting a
   * blank as a measurement.
   */
  contentSource?: 'html' | 'structured-data'
}

export type IngestAdapter = {
  name: string
  /** Whether this adapter can read the given client at all. */
  supports(client: Client): boolean
  fetchAll(client: Client, onProgress?: (msg: string) => void): Promise<IngestedPage[]>
}

export function slugFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? 'home'
  } catch {
    return 'home'
  }
}
