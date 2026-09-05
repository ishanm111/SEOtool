import * as cheerio from 'cheerio'
import {
  jsonLdSignals,
  parseJsonLd,
  schemaContentHtml,
  schemaTypesOf,
  visibleWordCount,
} from '../../lib/jsonld'
import { collectSitemapUrls, get, linksFromHtml, originOf } from '../../lib/sitemap'
import type { IngestAdapter, IngestedPage } from './types'
import { slugFromUrl } from './types'

/**
 * Below this many served words a page is treated as client-rendered. A real
 * page — even a thin one — carries a heading, a paragraph and a call to action;
 * an app shell carries a loading message at most.
 */
const RENDERED_TEXT_FLOOR = 50

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Upper bound on a single crawl, so a large site cannot run away with the day. */
const MAX_PAGES = 300

/**
 * Reads one page's HTML into the common shape. Shared with the Shopify adapter,
 * which needs it for the handful of pages that are not products or collections.
 */
export function extractPageFromHtml(
  html: string,
  url: string,
  pageType: IngestedPage['pageType'] = 'page',
): IngestedPage {
  const $ = cheerio.load(html)

  const nodes = parseJsonLd(html)
  const schemaTypes = new Set<string>(schemaTypesOf(nodes))
  $('[itemtype]').each((_, el) => {
    const t = $(el).attr('itemtype')?.split('/').pop()
    if (t) schemaTypes.add(t)
  })

  // Prefer the main content region; fall back to body so nothing is lost on
  // sites that never mark one up.
  const main = $('main').length ? $('main') : $('article').length ? $('article') : $('body')
  const contentHtml = main.html() ?? ''
  const renderedWordCount = visibleWordCount(contentHtml)

  /**
   * A page that serves no copy is not an empty page — it is a page whose copy
   * arrives in the browser. Its facts are still in the served HTML, in the
   * JSON-LD the site publishes for machines, so that is what gets read.
   *
   * Auditing the empty string instead would score every signal at zero and then
   * report those zeros to a client as measurements.
   */
  const fallback = renderedWordCount < RENDERED_TEXT_FLOOR ? schemaContentHtml(jsonLdSignals(nodes)) : ''

  return {
    externalId: null,
    url,
    slug: slugFromUrl(url),
    title: $('title').text().trim() || $('h1').first().text().trim(),
    metaDescription:
      $('meta[name="description"]').attr('content')?.trim() ??
      $('meta[property="og:description"]').attr('content')?.trim() ??
      '',
    contentHtml: fallback ? `${contentHtml}\n${fallback}` : contentHtml,
    schemaTypes: [...schemaTypes].sort(),
    pageType,
    renderedWordCount,
    contentSource: fallback ? 'structured-data' : 'html',
  }
}

/**
 * Works on any site: Webflow, Squarespace, Wix, or hand-built.
 *
 * Slower than an API because every page is a request, so it is the fallback
 * rather than the default — but it means no platform is unsupported.
 */
export const genericAdapter: IngestAdapter = {
  name: 'generic',

  supports: () => true,

  async fetchAll(client, onProgress) {
    const { origin, domain } = originOf(client.homepageUrl)

    let urls = await collectSitemapUrls(origin)
    if (urls.length === 0) {
      const home = await get(origin)
      if (!home) throw new Error(`could not reach ${origin}`)
      urls = linksFromHtml(home, origin, domain)
      onProgress?.(`no sitemap — using ${urls.length} homepage links (undercount)`)
    }

    const pathOf = (u: string): string | null => {
      try {
        return new URL(u).pathname
      } catch {
        return null
      }
    }
    // Sitemaps and link scrapes both yield the occasional relative or malformed
    // URL, which would throw when parsed.
    urls = urls.filter((u) => pathOf(u) !== null)
    if (!urls.some((u) => pathOf(u) === '/')) urls.unshift(origin + '/')

    const capped = urls.slice(0, MAX_PAGES)
    if (urls.length > MAX_PAGES) {
      onProgress?.(`site has ${urls.length} pages — reading the first ${MAX_PAGES}`)
    }

    const out: IngestedPage[] = []
    for (const [i, url] of capped.entries()) {
      const html = await get(url, 15000)
      if (!html) continue
      out.push(extractPageFromHtml(html, url))
      if ((i + 1) % 20 === 0) onProgress?.(`${i + 1}/${capped.length} fetched`)
      await sleep(250)
    }

    return out
  },
}
