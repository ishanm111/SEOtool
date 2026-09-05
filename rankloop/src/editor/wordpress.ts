import type {
  ApplyRequest,
  ApplyResult,
  ConnectionCheck,
  SiteEditor,
  StoredCredential,
} from './types'
import { replaceOnce } from './types'

/**
 * Publishes changes through the WordPress REST API using an application
 * password.
 *
 * An application password is used rather than the client's own login: it is
 * created per tool, it cannot be used to sign into wp-admin, and the client can
 * revoke it from their profile page without changing anything else they own.
 *
 * Titles and descriptions belong to whichever SEO plugin the site runs, and
 * those plugins differ in whether they expose their fields to the REST API at
 * all. So every write is read back and compared; a value the plugin quietly
 * declined is reported as a failure rather than as a success.
 */

/** The post-meta keys the common SEO plugins store their fields in. */
const SEO_META_KEYS = {
  meta_title: ['rank_math_title', '_yoast_wpseo_title', '_aioseo_title', '_seopress_titles_title'],
  meta_description: [
    'rank_math_description',
    '_yoast_wpseo_metadesc',
    '_aioseo_description',
    '_seopress_titles_desc',
  ],
} as const

type WpPost = {
  id: number
  link?: string
  title?: { raw?: string; rendered?: string }
  content?: { raw?: string; rendered?: string }
  meta?: Record<string, unknown>
  yoast_head_json?: { title?: string; description?: string }
}

function restBase(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '')
  if (/\/wp-json\/wp\/v2$/.test(trimmed)) return trimmed
  if (/\/wp-json$/.test(trimmed)) return `${trimmed}/wp/v2`
  return `${trimmed}/wp-json/wp/v2`
}

/** WordPress routes pages and posts separately, and they are not interchangeable. */
function collectionFor(pageType: string): string {
  return pageType === 'post' ? 'posts' : 'pages'
}

export function wordpressEditor(cred: StoredCredential): SiteEditor {
  const base = restBase(cred.endpoint)
  const auth = 'Basic ' + Buffer.from(`${cred.username}:${cred.secret}`).toString('base64')

  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        authorization: auth,
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

  const readPost = async (collection: string, id: string) => {
    const res = await call(`/${collection}/${id}?context=edit`)
    if (!res.ok) return null
    return res.body as WpPost
  }

  return {
    kind: 'wordpress',

    async check(): Promise<ConnectionCheck> {
      const me = await call('/users/me?context=edit')
      if (!me.ok) {
        if (me.status === 401) {
          return {
            ok: false,
            detail:
              'WordPress rejected the username and application password. Check both, and that the password was copied with its spaces.',
          }
        }
        if (me.status === 404) {
          return {
            ok: false,
            detail: `No REST API at ${base}. Check the site address, and that the REST API has not been disabled by a security plugin.`,
          }
        }
        return { ok: false, detail: `WordPress replied HTTP ${me.status}.` }
      }

      const user = me.body as { name?: string; capabilities?: Record<string, boolean> }
      const canEdit = user.capabilities?.edit_pages || user.capabilities?.edit_posts
      if (!canEdit) {
        return {
          ok: false,
          detail: `Signed in as ${user.name ?? 'that user'}, but they cannot edit pages. Use an Editor or Administrator account.`,
        }
      }
      return { ok: true, detail: `Connected as ${user.name ?? 'the account'}, with permission to edit pages.` }
    },

    refuse(request: ApplyRequest): string | null {
      if (!request.page.externalId) {
        return 'This page has no WordPress id recorded, so there is nothing to update. Re-run the site read first.'
      }
      if (request.field === 'copy' && !request.currentValue) {
        return 'There is no original wording recorded, so there is nothing to replace.'
      }
      return null
    },

    async apply(request: ApplyRequest): Promise<ApplyResult> {
      const collection = collectionFor(request.page.pageType)
      const id = request.page.externalId as string

      const before = await readPost(collection, id)
      if (!before) {
        return {
          ok: false,
          previousValue: null,
          error: `WordPress has no ${collection.replace(/s$/, '')} with id ${id}. Re-run the site read.`,
        }
      }

      if (request.field === 'copy') {
        const html = before.content?.raw ?? ''
        const swapped = replaceOnce(html, request.currentValue ?? '', request.proposedValue)
        if ('error' in swapped) return { ok: false, previousValue: null, error: swapped.error }

        const put = await call(`/${collection}/${id}`, {
          method: 'POST',
          body: JSON.stringify({ content: swapped.html }),
        })
        if (!put.ok) {
          return {
            ok: false,
            previousValue: html,
            error: `WordPress refused the change: HTTP ${put.status}.`,
          }
        }

        const after = await readPost(collection, id)
        const stuck = (after?.content?.raw ?? '').includes(request.proposedValue.trim())
        return stuck
          ? { ok: true, previousValue: html, detail: 'The paragraph was replaced and read back correctly.' }
          : {
              ok: false,
              previousValue: html,
              error:
                'WordPress accepted the change but the new wording is not in the page afterwards. A page builder is probably storing the real content elsewhere.',
            }
      }

      /**
       * A title or description belongs to the SEO plugin, so every known key is
       * written at once and then read back. Whichever plugin is installed keeps
       * its own; the rest are ignored.
       */
      const keys = SEO_META_KEYS[request.field]
      const previous =
        request.field === 'meta_title'
          ? before.yoast_head_json?.title ?? request.page.title
          : before.yoast_head_json?.description ?? request.page.metaDescription

      const meta = Object.fromEntries(keys.map((k) => [k, request.proposedValue]))
      const put = await call(`/${collection}/${id}`, {
        method: 'POST',
        body: JSON.stringify({ meta }),
      })
      if (!put.ok) {
        return {
          ok: false,
          previousValue: previous,
          error: `WordPress refused the change: HTTP ${put.status}.`,
        }
      }

      const after = await readPost(collection, id)
      const storedMeta = (after?.meta ?? {}) as Record<string, unknown>
      const stuckInMeta = keys.some((k) => String(storedMeta[k] ?? '') === request.proposedValue)
      const stuckInHead =
        request.field === 'meta_title'
          ? (after?.yoast_head_json?.title ?? '').includes(request.proposedValue)
          : (after?.yoast_head_json?.description ?? '') === request.proposedValue

      if (stuckInMeta || stuckInHead) {
        return {
          ok: true,
          previousValue: previous,
          detail: 'The SEO field was written and read back correctly.',
        }
      }

      return {
        ok: false,
        previousValue: previous,
        error:
          'WordPress accepted the request but the SEO plugin did not keep the value. Most plugins only expose these fields to the API when their REST integration is switched on — set it in the page editor instead, or enable that setting.',
      }
    },
  }
}
