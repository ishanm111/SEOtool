import type { ApplyRequest } from './types'

/**
 * Surgical edits to one attribute, or one link's wording, inside a page's own
 * markup.
 *
 * The same rule as `replaceOnce`, for the same reason: the thing being changed
 * has to be found exactly, exactly once, or the edit is declined. These run
 * against somebody's live website, and the failure a fuzzy match produces is
 * not a wrong alt attribute — it is a page that no longer renders.
 *
 * Deliberately not done with a parser. Cheerio is already a dependency and
 * would make the matching easier, but it re-serialises the whole document on
 * the way out: self-closing tags, attribute quoting and entity escaping all
 * come back subtly different, so a one-attribute edit would arrive as a diff
 * across the entire page. Everything here changes the bytes it was asked to
 * change and leaves every other byte alone.
 */

export type MarkupEdit = { html: string; previous: string } | { error: string }

/**
 * Entities back to the characters they stand for.
 *
 * What was already on the page comes back escaped, and that string is both the
 * value compared against what we asked for and the value stored to put back
 * later. Comparing escaped against unescaped would report every alt attribute
 * containing an ampersand as a write the platform refused.
 */
const unescapeHtml = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** An attribute's value, however it was quoted. */
function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'))
  if (!match) return null
  return match[2] ?? match[3] ?? match[4] ?? ''
}

/** Every occurrence of a tag, with where it starts, so one can be replaced by index. */
function tagsOf(html: string, name: string): { tag: string; start: number; end: number }[] {
  const out: { tag: string; start: number; end: number }[] = []
  const pattern = new RegExp(`<${name}\\b[^>]*>`, 'gi')
  for (const match of html.matchAll(pattern)) {
    out.push({ tag: match[0], start: match.index, end: match.index + match[0].length })
  }
  return out
}

/**
 * The src a lazy-loading plugin really points at.
 *
 * The audit reads the page after scripts have run, so the file it recorded may
 * be the one a plugin moved into `data-src` — and the stored markup is what
 * that plugin was given, not what it produced. Both are checked so the two
 * views of the same image agree.
 */
const SRC_ATTRIBUTES = ['src', 'data-src', 'data-lazy-src', 'data-original']

/** Writes an alt attribute on the one image with this src. */
export function setAltText(html: string, rawSrc: string, alt: string): MarkupEdit {
  const wanted = rawSrc.trim()
  if (!wanted) return { error: 'No image was recorded for this change.' }

  const matches = tagsOf(html, 'img').filter((img) =>
    SRC_ATTRIBUTES.some((name) => attribute(img.tag, name) === wanted),
  )

  if (matches.length === 0) {
    return {
      error:
        `No <img> in the page body points at ${wanted}. An image placed by the theme — a logo, ` +
        'a header, a background — is not in the page content and has to be given its alt text ' +
        'where the theme sets it.',
    }
  }
  if (matches.length > 1) {
    return {
      error: `That image appears ${matches.length} times on the page, so there is no way to tell which one was meant. Set the alt text by hand.`,
    }
  }

  const { tag, start, end } = matches[0]
  const previous = unescapeHtml(attribute(tag, 'alt') ?? '')
  const written = `alt="${escapeAttribute(alt)}"`
  const replaced = /\salt\s*=/i.test(tag)
    ? tag.replace(/\salt\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/i, ` ${written}`)
    : tag.replace(/^<img/i, `<img ${written}`)

  return { html: html.slice(0, start) + replaced + html.slice(end), previous }
}

/**
 * Rewrites the wording of the one link with this href.
 *
 * Refuses when the link holds anything but plain text. An anchor wrapping an
 * icon, a span or an image has structure this cannot rebuild, and replacing its
 * contents wholesale would delete that structure along with the wording.
 */
export function setLinkText(
  html: string,
  rawHref: string,
  currentText: string | null,
  newText: string,
): MarkupEdit {
  const wanted = rawHref.trim()
  if (!wanted) return { error: 'No link was recorded for this change.' }

  const collapse = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const expected = collapse(currentText ?? '')

  const candidates: { start: number; end: number; inner: string }[] = []
  for (const open of tagsOf(html, 'a')) {
    if (attribute(open.tag, 'href') !== wanted) continue
    const close = html.toLowerCase().indexOf('</a>', open.end)
    if (close === -1) continue
    const inner = html.slice(open.end, close)
    // A nested anchor means the close tag found belongs to the inner one.
    if (/<a\b/i.test(inner)) continue
    candidates.push({ start: open.end, end: close, inner })
  }

  if (candidates.length === 0) {
    return {
      error:
        `No link to ${wanted} is in the page body. A link in the menu, the header or the footer ` +
        'belongs to the theme rather than to this page, and has to be renamed where the theme ' +
        'sets it.',
    }
  }

  const matching = expected
    ? candidates.filter((c) => collapse(c.inner.replace(/<[^>]*>/g, '')) === expected)
    : candidates

  if (matching.length === 0) {
    return {
      error:
        `A link to ${wanted} is in the page, but its wording is no longer “${currentText}”. ` +
        'Somebody has changed it since the audit ran — re-run the presentation step and look again.',
    }
  }
  if (matching.length > 1) {
    return {
      error: `That link appears ${matching.length} times on the page with the same wording, so there is no way to tell which one was meant. Rename it by hand.`,
    }
  }

  const chosen = matching[0]
  if (/<[^>]+>/.test(chosen.inner.trim())) {
    return {
      error:
        'This link holds more than words — an icon or an image sits inside it — so its wording ' +
        'cannot be swapped without losing that. Edit it in the page editor instead.',
    }
  }

  return {
    html: html.slice(0, chosen.start) + escapeText(newText) + html.slice(chosen.end),
    previous: unescapeHtml(chosen.inner.trim()),
  }
}

/**
 * Whichever markup edit a request is, so both platforms do it identically.
 *
 * The locator is the src or the href exactly as the audit read it off the page;
 * without one there is nothing to find, and the edit is declined rather than
 * applied to whichever image or link happens to be first.
 */
export function editMarkup(request: ApplyRequest, html: string): MarkupEdit {
  if (!request.locator) {
    return {
      error:
        'This change does not record which image or link it belongs to, so there is nothing to ' +
        'find. Re-run the presentation step.',
    }
  }
  if (request.field === 'image_alt') {
    return setAltText(html, request.locator, request.proposedValue)
  }
  if (request.field === 'link_text') {
    return setLinkText(html, request.locator, request.currentValue, request.proposedValue)
  }
  return { error: `There is no markup edit for a ${request.field} change.` }
}

/**
 * Whether the page read back afterwards really holds the change.
 *
 * Done by looking for the change rather than by trusting the response, for the
 * same reason every other write here is: a platform that accepted a value and
 * dropped it must be reported as a failure. The probe asks what is there now,
 * so the wording it matches on is the new wording, not the old.
 */
export function markupHolds(request: ApplyRequest, html: string): boolean {
  const probe = editMarkup(
    { ...request, currentValue: request.proposedValue, proposedValue: '' },
    html,
  )
  return 'previous' in probe && probe.previous === request.proposedValue.trim()
}
