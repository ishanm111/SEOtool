import { collectSitemapUrls, get, getJson } from '../../lib/sitemap'
import type { IngestAdapter, IngestedPage } from './types'
import { extractPageFromHtml } from './generic'

type ShopifyProduct = {
  id: number
  title: string
  handle: string
  body_html: string
  product_type?: string
  tags?: string[]
  vendor?: string
  variants?: { price?: string }[]
}

type ShopifyCollection = {
  id: number
  title: string
  handle: string
  body_html?: string
  description?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Shopify publishes products and collections as JSON on every storefront, with
 * no credentials and no app install. Content comes back clean, which is far more
 * reliable than parsing a theme's HTML.
 *
 * Product type, vendor and tags are folded into the body so the scoring layer
 * sees them — a product page that names its brand and category reads very
 * differently to an AI engine than one that does not.
 */
export const shopifyAdapter: IngestAdapter = {
  name: 'shopify',

  supports: (client) => client.platform === 'shopify' && !!client.apiBase,

  async fetchAll(client, onProgress) {
    const origin = (client.apiBase ?? client.homepageUrl).replace(/\/$/, '')
    const out: IngestedPage[] = []

    // ── products
    for (let page = 1; page <= 25; page++) {
      const data = await getJson<{ products?: ShopifyProduct[] }>(
        `${origin}/products.json?limit=250&page=${page}`,
      )
      const batch = data?.products
      if (!batch || batch.length === 0) break

      for (const p of batch) {
        /**
         * Shopify tags carry two very different things: real merchandising tags
         * a shopper would recognise, and internal machinery ("namespace::key =>
         * value"). Only the former belongs in content that gets scored — the
         * latter would inflate word counts and pollute every readability score.
         */
        const realTags = (p.tags ?? []).filter(
          (t) => !t.includes('::') && !t.includes('=>') && t.length < 40,
        )

        const meta = [
          p.product_type ? `<p>Category: ${p.product_type}</p>` : '',
          p.vendor ? `<p>Brand: ${p.vendor}</p>` : '',
          realTags.length ? `<p>Tags: ${realTags.join(', ')}</p>` : '',
        ].join('')

        out.push({
          externalId: String(p.id),
          url: `${origin}/products/${p.handle}`,
          slug: p.handle,
          title: p.title,
          metaDescription: '',
          contentHtml: `<h1>${p.title}</h1>${meta}${p.body_html ?? ''}`,
          schemaTypes: [],
          pageType: 'product',
        })
      }

      onProgress?.(`products: ${out.length}`)
      if (batch.length < 250) break
      await sleep(300)
    }

    // ── collections
    const collections = await getJson<{ collections?: ShopifyCollection[] }>(
      `${origin}/collections.json?limit=250`,
    )
    for (const c of collections?.collections ?? []) {
      out.push({
        externalId: String(c.id),
        url: `${origin}/collections/${c.handle}`,
        slug: c.handle,
        title: c.title,
        metaDescription: '',
        contentHtml: `<h1>${c.title}</h1>${c.body_html ?? c.description ?? ''}`,
        schemaTypes: [],
        pageType: 'collection',
      })
    }
    onProgress?.(`collections: ${collections?.collections?.length ?? 0}`)

    // ── everything else (about, FAQ, policies) via the sitemap
    const seen = new Set(out.map((p) => p.url.replace(/\/$/, '')))
    const sitemapUrls = await collectSitemapUrls(origin)
    const contentPages = sitemapUrls.filter((u) => {
      const clean = u.replace(/\/$/, '')
      if (seen.has(clean)) return false
      return /\/(pages|blogs)\//.test(u) || new URL(u).pathname === '/'
    })

    const CONTENT_PAGE_CAP = 60
    const toFetch = contentPages.slice(0, CONTENT_PAGE_CAP)
    for (const url of toFetch) {
      const html = await get(url, 15000)
      if (!html) continue
      out.push(extractPageFromHtml(html, url, 'page'))
      await sleep(250)
    }
    onProgress?.(
      contentPages.length > CONTENT_PAGE_CAP
        ? `content pages: read ${toFetch.length} of ${contentPages.length} (capped)`
        : `content pages: ${toFetch.length}`,
    )

    return out
  },
}
