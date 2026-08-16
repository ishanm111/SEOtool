import * as cheerio from 'cheerio'

export type Block = {
  heading: string
  text: string
  hasLink: boolean
  sortOrder: number
}

const BLOCK_TAGS = 'p, li, td, blockquote'
const HEADING_TAGS = 'h1, h2, h3, h4'

function clean(s: string): string {
  return s
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Elementor renders pages as deeply nested divs. We ignore the wrapper markup
 * entirely and walk the document for real text blocks, remembering whichever
 * heading came last so each paragraph keeps its section context.
 */
export function splitContent(html: string): { plainText: string; blocks: Block[] } {
  const $ = cheerio.load(html)

  $('script, style, noscript, svg, form, nav, footer').remove()

  const blocks: Block[] = []
  let currentHeading = ''
  let order = 0

  $(`${HEADING_TAGS}, ${BLOCK_TAGS}`).each((_, el) => {
    const $el = $(el)
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? ''
    const text = clean($el.text())
    if (!text) return

    if (/^h[1-4]$/.test(tag)) {
      currentHeading = text
      return
    }

    // Skip nav-ish fragments and stray labels
    if (text.length < 40) return

    // A <li> inside a <p> would double-count; cheerio's selector order means the
    // parent fires first, so drop children whose text is already captured.
    if (blocks.some((b) => b.text.includes(text))) return

    blocks.push({
      heading: currentHeading,
      text,
      hasLink: $el.find('a[href^="http"]').length > 0,
      sortOrder: order++,
    })
  })

  const plainText = clean($.root().text())
  return { plainText, blocks }
}
