/**
 * Writing an approved change back to a client's own website.
 *
 * Three rules hold for every platform:
 *
 *  1. Read before writing. The value that was there is stored alongside the new
 *     one, so any change can be put back.
 *  2. Verify after writing. A 200 response is not proof: SEO plugins routinely
 *     accept a field and drop it. The value is read back and compared.
 *  3. Refuse rather than guess. If the original wording cannot be located
 *     exactly, the edit is declined with a reason — a fuzzy match against
 *     someone's live homepage is not a risk worth taking.
 */

export type EditableField = 'meta_title' | 'meta_description' | 'copy'

export type TargetPage = {
  id: number
  externalId: string | null
  url: string
  slug: string
  pageType: string
  title: string
  metaDescription: string
}

export type ApplyRequest = {
  page: TargetPage
  field: EditableField
  /** The exact text being replaced. Required for a copy edit. */
  currentValue: string | null
  proposedValue: string
}

export type ApplyResult =
  | { ok: true; previousValue: string | null; detail: string }
  | { ok: false; previousValue: string | null; error: string }

export type ConnectionCheck = { ok: boolean; detail: string }

export type SiteEditor = {
  kind: 'wordpress' | 'shopify'
  /** Proves the credentials work, and that they can write as well as read. */
  check(): Promise<ConnectionCheck>
  /** Why a given edit cannot be made, or null when it can. */
  refuse(request: ApplyRequest): string | null
  apply(request: ApplyRequest): Promise<ApplyResult>
}

export type StoredCredential = {
  id: number
  clientId: number
  kind: string
  endpoint: string
  username: string
  secret: string
  status: string
  detail: string | null
}

/**
 * Replaces one exact block of text inside a page's HTML.
 *
 * Deliberately strict: the original has to appear exactly once. Zero matches
 * means the wording is split by inline markup and a replacement would corrupt
 * the page; more than one means there is no way to know which was meant.
 */
export function replaceOnce(
  html: string,
  find: string,
  replace: string,
): { html: string } | { error: string } {
  const needle = find.trim()
  if (!needle) return { error: 'There is no original wording recorded to replace.' }

  const count = html.split(needle).length - 1
  if (count === 0) {
    return {
      error:
        'The original wording is not in the page source as one continuous block — it is usually split by a link or inline formatting. Paste the replacement in the editor instead.',
    }
  }
  if (count > 1) {
    return {
      error: `That wording appears ${count} times on the page, so there is no way to tell which one was meant. Edit it by hand.`,
    }
  }
  return { html: html.replace(needle, replace) }
}
