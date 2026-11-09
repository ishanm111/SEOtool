import type { SiteEditor, StoredCredential } from './types'
import { wordpressEditor } from './wordpress'
import { shopifyEditor } from './shopify'

export * from './types'

/**
 * The editor for a stored credential, or null when the tool has no way to write
 * to that kind of site.
 *
 * Only platforms with a real write API appear here. A site built in a page
 * builder with no API cannot be edited from a console, and pretending otherwise
 * would mean an operator ticking off fixes that never reached the website.
 */
export function editorFor(cred: StoredCredential): SiteEditor | null {
  if (cred.kind === 'wordpress') return wordpressEditor(cred)
  if (cred.kind === 'shopify') return shopifyEditor(cred)
  return null
}

/**
 * Which recommendation kinds can be published, and why the others cannot.
 *
 * A kind belongs here only when both editors can write it and read it back. The
 * presentation audit produces four kinds; two of them are an attribute and a run
 * of text inside the page body, which is a field both platforms already expose,
 * and two of them live in the theme — so those two are listed below with what to
 * do about them instead. A kind added here that an editor cannot actually write
 * would show an operator a working button that ticks a fix off a list without
 * ever reaching the website.
 */
export const PUBLISHABLE_KINDS = new Set([
  'meta_title',
  'meta_description',
  'copy',
  'image_alt',
  'link_text',
])

export const WHY_NOT_PUBLISHABLE: Record<string, string> = {
  schema:
    'Structured data is a block of JSON-LD that has to go in the page template, not in a field. Paste it into the theme or the SEO plugin.',
  new_page:
    'A page that does not exist yet has to be created and placed in the navigation by a person. The copy below is ready to paste.',
  blog_post:
    'A post that does not exist yet has to be created, dated and published by a person. The body below is ready to paste, and every highlighted gap has to be filled in first.',
  heading:
    'On almost every site the page’s own title is what the theme renders as the <h1>, so this is fixed in the template or by renaming the page — not by editing the body. Use the heading below.',
  viewport:
    'The viewport tag sits in the <head> of the site’s theme, not in any page’s fields, so it is changed once in the theme and fixes every page at once. Paste the tag below.',
}
