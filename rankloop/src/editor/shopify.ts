import type {
  ApplyRequest,
  ApplyResult,
  ConnectionCheck,
  SiteEditor,
  StoredCredential,
} from './types'
import { replaceOnce } from './types'

/**
 * Publishes changes through the Shopify Admin API using a custom app's access
 * token.
 *
 * Shopify keeps the browser tab title and the search-result description as
 * metafields rather than as product fields — `global.title_tag` and
 * `global.description_tag`. Writing the product's own `title` would rename the
 * product across the whole store, which is a different and much larger change
 * than the one being approved, so it is never done here.
 */

const API_VERSION = '2025-01'

type ShopifyProduct = {
  id: number
  title: string
  body_html: string | null
}

type Metafield = { id: number; namespace: string; key: string; value: string }

/** Accepts a store domain typed any of the ways a person types it. */
function shopDomain(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return trimmed
}

export function shopifyEditor(cred: StoredCredential): SiteEditor {
  const domain = shopDomain(cred.endpoint)
  const root = `https://${domain}/admin/api/${API_VERSION}`

  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${root}${path}`, {
      ...init,
      headers: {
        'x-shopify-access-token': cred.secret,
        'content-type': 'application/json',
        accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    const text = await res.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    return { ok: res.ok, status: res.status, body }
  }

  const readProduct = async (id: string) => {
    const res = await call(`/products/${id}.json`)
    if (!res.ok) return null
    return (res.body as { product?: ShopifyProduct }).product ?? null
  }

  const readMetafields = async (id: string): Promise<Metafield[]> => {
    const res = await call(`/products/${id}/metafields.json?namespace=global`)
    if (!res.ok) return []
    return (res.body as { metafields?: Metafield[] }).metafields ?? []
  }

  return {
    kind: 'shopify',

    async check(): Promise<ConnectionCheck> {
      const shop = await call('/shop.json')
      if (!shop.ok) {
        if (shop.status === 401 || shop.status === 403) {
          return {
            ok: false,
            detail:
              'Shopify rejected the access token. Check it is an Admin API token from a custom app, and that the app has been installed on the store.',
          }
        }
        if (shop.status === 404) {
          return {
            ok: false,
            detail: `No store answered at ${domain}. Use the store's own address, ending in .myshopify.com.`,
          }
        }
        return { ok: false, detail: `Shopify replied HTTP ${shop.status}.` }
      }

      // Reading the shop proves the token is valid; reading a product proves it
      // carries the scope the edits actually need.
      const products = await call('/products.json?limit=1')
      if (!products.ok) {
        return {
          ok: false,
          detail:
            'The token works but cannot read products. Give the custom app read and write access to products, then reinstall it.',
        }
      }

      const name = (shop.body as { shop?: { name?: string } }).shop?.name
      return { ok: true, detail: `Connected to ${name ?? domain}, with access to products.` }
    },

    refuse(request: ApplyRequest): string | null {
      if (!request.page.externalId) {
        return 'This page has no Shopify id recorded, so there is nothing to update. Re-run the site read first.'
      }
      if (request.page.pageType !== 'product') {
        return 'Only products can be published from here. Collections and pages have to be edited in Shopify admin.'
      }
      if (request.field === 'copy' && !request.currentValue) {
        return 'There is no original wording recorded, so there is nothing to replace.'
      }
      return null
    },

    async apply(request: ApplyRequest): Promise<ApplyResult> {
      const id = request.page.externalId as string
      const product = await readProduct(id)
      if (!product) {
        return {
          ok: false,
          previousValue: null,
          error: `Shopify has no product with id ${id}. Re-run the site read.`,
        }
      }

      if (request.field === 'copy') {
        const html = product.body_html ?? ''
        const swapped = replaceOnce(html, request.currentValue ?? '', request.proposedValue)
        if ('error' in swapped) return { ok: false, previousValue: null, error: swapped.error }

        const put = await call(`/products/${id}.json`, {
          method: 'PUT',
          body: JSON.stringify({ product: { id: Number(id), body_html: swapped.html } }),
        })
        if (!put.ok) {
          return {
            ok: false,
            previousValue: html,
            error: `Shopify refused the change: HTTP ${put.status}.`,
          }
        }

        const after = await readProduct(id)
        return (after?.body_html ?? '').includes(request.proposedValue.trim())
          ? { ok: true, previousValue: html, detail: 'The description was replaced and read back correctly.' }
          : {
              ok: false,
              previousValue: html,
              error: 'Shopify accepted the change but the new wording is not on the product afterwards.',
            }
      }

      const key = request.field === 'meta_title' ? 'title_tag' : 'description_tag'
      const existing = (await readMetafields(id)).find(
        (m) => m.namespace === 'global' && m.key === key,
      )
      const previous =
        existing?.value ??
        (request.field === 'meta_title' ? request.page.title : request.page.metaDescription)

      const payload = {
        metafield: {
          namespace: 'global',
          key,
          value: request.proposedValue,
          type: 'single_line_text_field',
          ...(existing ? { id: existing.id } : {}),
        },
      }

      const write = existing
        ? await call(`/metafields/${existing.id}.json`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await call(`/products/${id}/metafields.json`, {
            method: 'POST',
            body: JSON.stringify(payload),
          })

      if (!write.ok) {
        return {
          ok: false,
          previousValue: previous,
          error: `Shopify refused the change: HTTP ${write.status}.`,
        }
      }

      const after = (await readMetafields(id)).find((m) => m.key === key)
      return after?.value === request.proposedValue
        ? { ok: true, previousValue: previous, detail: 'The metafield was written and read back correctly.' }
        : {
            ok: false,
            previousValue: previous,
            error: 'Shopify accepted the request but the metafield does not hold the new value afterwards.',
          }
    },
  }
}
