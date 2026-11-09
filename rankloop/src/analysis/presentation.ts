import type { NewFinding } from './findings'

/**
 * How a page is built and presented, as opposed to what it says.
 *
 * The rest of the tool reads copy. This reads the thing the copy sits in: the
 * buttons, the forms, the type sizes, the colours, how fast the main content
 * lands and whether it moves once it has.
 *
 * A caveat worth keeping in the code, because it is the first question anyone
 * asks about this module. **No engine ranks a button because it is a nicer
 * colour.** What is measured here is the subset of presentation that search
 * engines and AI assistants demonstrably react to:
 *
 *  - Core Web Vitals (LCP, CLS) are an explicit Google ranking signal.
 *  - Mobile usability — viewport, tap targets, horizontal overflow — decides
 *    whether a page is eligible at all on the index that matters.
 *  - Heading order, alt text and link wording are how a machine works out what
 *    a page is about. An assistant quoting a page has to parse it first, and
 *    "click here" names nothing it can cite.
 *  - Readability — type size, line length, contrast — is the one presentation
 *    factor the GEO paper measures directly.
 *
 * Everything else that got asked for — whether a form is too long, whether a
 * phone number is reachable — is marked `conversion` rather than dressed up as
 * a ranking factor. It is often the most valuable thing on the list. It is just
 * not a ranking factor, and a tool that blurs the two is one whose numbers stop
 * meaning anything.
 */

/** What a check is actually claiming, so the interface never oversells one. */
export type Lever = 'ranking' | 'comprehension' | 'conversion'

export const LEVER_NOTE: Record<Lever, string> = {
  ranking: 'A measured Google ranking signal.',
  comprehension: 'Changes how an engine or assistant reads the page.',
  conversion: 'Does not affect ranking. Affects whether a visitor acts.',
}

/**
 * One image with no alt text, together with the wording already around it.
 *
 * Collected so a replacement can be *quoted* rather than invented. Nothing here
 * is a description of the picture — it is the text the site itself already puts
 * next to it, ranked by how tightly it is bound to that image, and a proposal
 * that cannot be built from one of these is emitted as a gap for the business
 * to fill rather than as a guess.
 */
export type AltlessImage = {
  /** The src exactly as the markup writes it, which is how the edit finds it. */
  rawSrc: string
  /** The same src resolved, so an operator can see which image is meant. */
  src: string
  /** A <figcaption>, or the img's own title attribute. Describes the image. */
  caption: string
  /** The link's wording, when the image is the whole of a link. */
  linkText: string
}

/** Everything measured in the browser for one page. */
export type PageVitals = {
  url: string
  /** Largest Contentful Paint, milliseconds. Null when it never fired. */
  lcpMs: number | null
  /** Cumulative Layout Shift, unitless. */
  cls: number | null
  hasViewportMeta: boolean
  viewportContent: string | null
  /** Widest element overflowing a 390px viewport, or null. */
  overflowPx: number | null
  bodyFontPx: number | null
  h1Count: number
  /** Heading levels in document order, e.g. [1,2,2,4] — the 4 is a skip. */
  headingOrder: number[]
  imagesTotal: number
  imagesMissingAlt: number
  /** Interactive elements below the 44x44 CSS-pixel comfortable minimum. */
  smallTapTargets: { text: string; width: number; height: number }[]
  /** Link and button wording that names no destination. */
  vagueActions: string[]
  /**
   * The vague wording that belongs to a link with somewhere to go.
   *
   * Kept apart from `vagueActions`, which also counts buttons. A button's
   * wording cannot be rewritten from the page: nothing on the page says where
   * it leads. A link's can, because the destination is in the href.
   */
  vagueLinks: { text: string; rawHref: string; href: string }[]
  /** Images with no alt text, with whatever wording sits next to each. */
  altless: AltlessImage[]
  /** The page's own <title> — wording already on the page, usable as an h1. */
  documentTitle: string
  /** The first subheading, the other place an <h1> can be taken from. */
  firstH2: string
  /** Body text whose contrast against its own background is under 4.5:1. */
  lowContrast: {
    text: string
    ratio: number
    color: string
    /** The colour after any transparency is painted over the backdrop. */
    effective: string
    background: string
  }[]
  formFields: number
  unlabelledFields: number
  hasTelLink: boolean
  hasForm: boolean
}

const VAGUE = [
  'click here',
  'read more',
  'learn more',
  'more info',
  'more information',
  'find out more',
  'see more',
  'here',
  'this',
  'submit',
  'go',
  'continue',
  'details',
]

/**
 * The script that runs inside the page.
 *
 * A single string rather than a set of small functions because it is serialised
 * into the browser context, where none of this module's imports exist.
 */
export const COLLECT_SCRIPT = `(() => {
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  /** [r, g, b, a]; null when fully transparent, which paints nothing. */
  const parse = (value) => {
    const m = value && value.match(/rgba?\\(([^)]+)\\)/)
    if (!m) return null
    const parts = m[1].split(/[,\\s/]+/).filter(Boolean).map((p) => parseFloat(p))
    const alpha = parts.length >= 4 ? parts[3] : 1
    if (!(alpha > 0)) return null
    return [parts[0], parts[1], parts[2], alpha]
  }

  /** Semi-transparent text is painted over its backdrop before it is read. */
  const composite = (fg, bg) => [
    fg[0] * fg[3] + bg[0] * (1 - fg[3]),
    fg[1] * fg[3] + bg[1] * (1 - fg[3]),
    fg[2] * fg[3] + bg[2] * (1 - fg[3]),
  ]

  const visible = (el) => {
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none') return false
    if (parseFloat(style.opacity) === 0) return false
    const rect = el.getBoundingClientRect()
    return rect.width > 1 && rect.height > 1
  }

  /**
   * The first ancestor that actually paints a background.
   *
   * Returns null when the backdrop is an image or a gradient. Contrast against
   * a photograph is not a number this can compute — it varies pixel by pixel —
   * and guessing one produces exactly the false positive that makes an audit
   * worth ignoring: cream text over a dark hero photo scored against the cream
   * further up the tree.
   */
  const backgroundOf = (el) => {
    let node = el
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node)
      if (style.backgroundImage && style.backgroundImage !== 'none') return null
      const rgb = parse(style.backgroundColor)
      // Only a background that fully covers counts as the backdrop; a tint is
      // painted over whatever is behind it, which is the next ancestor up.
      if (rgb && rgb[3] === 1) return [rgb[0], rgb[1], rgb[2]]
      node = node.parentElement
    }
    const rootImage = getComputedStyle(document.documentElement).backgroundImage
    if (rootImage && rootImage !== 'none') return null
    return [255, 255, 255]
  }

  const contrast = (a, b) => {
    const la = luminance(a)
    const lb = luminance(b)
    const [hi, lo] = la > lb ? [la, lb] : [lb, la]
    return (hi + 0.05) / (lo + 0.05)
  }

  const VAGUE = ${JSON.stringify(VAGUE)}

  const viewportMeta = document.querySelector('meta[name="viewport"]')

  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .map((h) => Number(h.tagName[1]))

  const images = [...document.querySelectorAll('img')]
    .filter((img) => img.getAttribute('role') !== 'presentation')

  const interactive = [...document.querySelectorAll('a[href], button, input[type=submit], [role=button]')]

  const smallTapTargets = []
  const vagueActions = []
  const vagueLinks = []
  const seenLink = new Set()
  for (const el of interactive) {
    if (!visible(el)) continue
    const rect = el.getBoundingClientRect()
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim()
    if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
      smallTapTargets.push({
        text: text.slice(0, 60),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }
    const plain = text.toLowerCase().replace(/[^a-z ]/g, '').trim()
    if (plain && VAGUE.includes(plain)) {
      vagueActions.push(text.slice(0, 60))
      /**
       * Only a link with a real destination can have its wording rewritten from
       * the page. A button, or an anchor pointing at "#", leads nowhere this can
       * read, so the page says nothing to name it after.
       */
      const raw = el.tagName === 'A' ? el.getAttribute('href') || '' : ''
      const key = raw + '|' + plain
      if (raw && !/^(#|javascript:)/i.test(raw) && !seenLink.has(key)) {
        seenLink.add(key)
        vagueLinks.push({ text: text.slice(0, 60), rawHref: raw, href: el.href })
      }
    }
  }

  /**
   * The file an image really points at.
   *
   * A lazy-loaded image carries a placeholder in src and the real file in a
   * data- attribute, and it is the real one that appears in the stored markup —
   * so it is the one an edit has to find.
   */
  const srcOf = (img) => {
    const direct = img.getAttribute('src') || ''
    if (direct && !/^data:/i.test(direct)) return direct
    for (const attr of ['data-src', 'data-lazy-src', 'data-original', 'data-srcset']) {
      const value = img.getAttribute(attr)
      if (value) return value.split(',')[0].trim().split(/\\s+/)[0]
    }
    return direct
  }

  // innerText keeps the line breaks of whatever block the text came out of, and
  // a caption is one line by the time anybody reads it.
  const oneLine = (value) => (value || '').replace(/\\s+/g, ' ').trim()

  // Whatever wording the site already puts next to an image with no alt text.
  // None of it is a description of the picture; it is what there is to quote.
  const altless = []
  const seenSrc = new Set()
  for (const img of images) {
    if ((img.getAttribute('alt') || '').trim()) continue
    const rawSrc = srcOf(img)
    if (!rawSrc || seenSrc.has(rawSrc)) continue
    seenSrc.add(rawSrc)
    const figcaption = img.closest('figure')
      ? img.closest('figure').querySelector('figcaption')
      : null
    const link = img.closest('a[href]')
    altless.push({
      rawSrc,
      src: img.currentSrc || img.src || rawSrc,
      caption: (oneLine(figcaption ? figcaption.innerText : '') ||
        oneLine(img.getAttribute('title'))).slice(0, 160),
      linkText: link ? oneLine(link.innerText).slice(0, 160) : '',
    })
  }

  const firstH2 = document.querySelector('h2')

  // Blocks of real prose only. Running contrast over every node reports the
  // same colour pair dozens of times and buries the one that matters.
  const lowContrast = []
  const seen = new Set()
  for (const el of document.querySelectorAll('p, li, td, dd, blockquote')) {
    const text = (el.innerText || '').trim()
    if (text.length < 40) continue
    if (!visible(el)) continue
    const style = getComputedStyle(el)
    const raw = parse(style.color)
    if (!raw) continue
    const bg = backgroundOf(el)
    if (!bg) continue
    const fg = composite(raw, bg)
    const ratio = contrast(fg, bg)
    const key = style.color + '|' + bg.join(',')
    /**
     * A ratio at or near 1:1 means the text colour and the backdrop this found
     * are the same colour. Real sites almost never ship invisible body copy;
     * what it actually means is that the visible backdrop was painted by
     * something the DOM walk cannot see — a ::before layer, a positioned
     * sibling behind the text, a canvas. Reporting those as contrast faults is
     * how an audit earns a reputation for crying wolf, so they are dropped
     * rather than guessed at. Genuinely low contrast lands between 1.2 and 4.5.
     */
    if (ratio >= 1.2 && ratio < 4.5 && !seen.has(key)) {
      seen.add(key)
      lowContrast.push({
        text: text.slice(0, 80),
        ratio: Math.round(ratio * 100) / 100,
        color: style.color,
        effective: 'rgb(' + fg.map((n) => Math.round(n)).join(', ') + ')',
        background: 'rgb(' + bg.join(', ') + ')',
      })
    }
  }

  const fields = [...document.querySelectorAll('input, select, textarea')]
    .filter((f) => !['hidden', 'submit', 'button'].includes(f.type))

  const unlabelled = fields.filter((f) => {
    if (f.getAttribute('aria-label') || f.getAttribute('aria-labelledby')) return false
    if (f.id && document.querySelector('label[for="' + CSS.escape(f.id) + '"]')) return false
    return !f.closest('label')
  })

  const bodyFont = parseFloat(getComputedStyle(document.body).fontSize)

  return {
    hasViewportMeta: Boolean(viewportMeta),
    viewportContent: viewportMeta ? viewportMeta.getAttribute('content') : null,
    overflowPx: Math.max(0, Math.round(document.documentElement.scrollWidth - window.innerWidth)) || null,
    bodyFontPx: Number.isFinite(bodyFont) ? Math.round(bodyFont * 10) / 10 : null,
    h1Count: document.querySelectorAll('h1').length,
    headingOrder: headings,
    imagesTotal: images.length,
    imagesMissingAlt: images.filter((i) => !(i.getAttribute('alt') || '').trim()).length,
    smallTapTargets: smallTapTargets.slice(0, 12),
    vagueActions: [...new Set(vagueActions)].slice(0, 12),
    vagueLinks: vagueLinks.slice(0, 10),
    altless: altless.slice(0, 10),
    documentTitle: (document.title || '').trim(),
    firstH2: firstH2 ? (firstH2.innerText || '').trim().slice(0, 120) : '',
    lowContrast: lowContrast.slice(0, 6),
    formFields: fields.length,
    unlabelledFields: unlabelled.length,
    hasTelLink: Boolean(document.querySelector('a[href^="tel:"]')),
    hasForm: Boolean(document.querySelector('form')),
  }
})()`

/** The first heading level that arrives without its parent level above it. */
function firstSkippedLevel(order: number[]): number | null {
  let deepest = 0
  for (const level of order) {
    if (deepest > 0 && level > deepest + 1) return level
    deepest = Math.max(deepest, level)
  }
  return null
}

/**
 * Turns one page's measurements into findings.
 *
 * Severity is set by how much of the page is affected and which lever it pulls,
 * never by how easy it is to fix. A tempting shortcut is to rank the quick wins
 * highest; the result is a list where the top item is always the cheapest one
 * rather than the one costing the most traffic.
 */
/**
 * The categories this module owns.
 *
 * `analyze` clears a client's findings before rebuilding them, and these are
 * produced by a separate pass that drives a browser. Without a list of what
 * belongs to whom, running analyze would silently delete every presentation
 * finding and an operator would watch them vanish for no visible reason.
 */
export const PRESENTATION_CATEGORIES = [
  'mobile-viewport',
  'horizontal-overflow',
  'largest-paint',
  'layout-shift',
  'heading-order',
  'image-alt',
  'link-text',
  'text-size',
  'contrast',
  'tap-targets',
  'form-labels',
  'form-length',
  'no-call-to-action',
] as const

export function presentationFindings(
  vitals: PageVitals,
  pageId: number,
  isHomepage: boolean,
): (NewFinding & { lever: Lever })[] {
  const out: (NewFinding & { lever: Lever })[] = []
  const at = (issue: string) => `${issue} — ${vitals.url}`

  const add = (
    category: string,
    severity: NewFinding['severity'],
    lever: Lever,
    issue: string,
    proposedText: string,
    evidence?: string,
  ) => {
    out.push({
      targetType: 'page',
      targetId: pageId,
      category,
      severity,
      issue: at(issue),
      currentText: null,
      proposedText,
      evidence: evidence ?? null,
      lever,
    })
  }

  if (!vitals.hasViewportMeta) {
    add(
      'mobile-viewport',
      'critical',
      'ranking',
      'The page has no viewport meta tag, so phones render it at desktop width and zoom out',
      'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the <head>.',
      'Google indexes the mobile rendering of a page first. Without this tag that rendering is a shrunken desktop one.',
    )
  } else if (vitals.viewportContent && !/width\s*=\s*device-width/i.test(vitals.viewportContent)) {
    add(
      'mobile-viewport',
      'high',
      'ranking',
      `The viewport tag does not set width=device-width (it says "${vitals.viewportContent}")`,
      'Change the viewport tag to content="width=device-width, initial-scale=1".',
    )
  }

  if (vitals.overflowPx && vitals.overflowPx > 8) {
    add(
      'horizontal-overflow',
      'high',
      'ranking',
      `Content runs ${vitals.overflowPx}px wider than a phone screen, so the page scrolls sideways`,
      'Find the element wider than its container — usually a fixed-width image, table or embed — and give it max-width: 100%.',
      'Horizontal scrolling is one of the mobile-usability faults Google reports directly in Search Console.',
    )
  }

  if (vitals.lcpMs !== null && vitals.lcpMs > 2500) {
    add(
      'largest-paint',
      vitals.lcpMs > 4000 ? 'critical' : 'high',
      'ranking',
      `The main content takes ${(vitals.lcpMs / 1000).toFixed(1)}s to appear (Google's threshold is 2.5s)`,
      'Usually the hero image: serve it at the size it is displayed, in WebP, and without lazy-loading the one above the fold.',
      'Largest Contentful Paint is one of the three Core Web Vitals used as a ranking signal.',
    )
  }

  if (vitals.cls !== null && vitals.cls > 0.1) {
    add(
      'layout-shift',
      vitals.cls > 0.25 ? 'high' : 'medium',
      'ranking',
      `The layout jumps while loading (CLS ${vitals.cls.toFixed(2)}, Google's threshold is 0.10)`,
      'Give every image and embed an explicit width and height so the browser reserves the space before it loads.',
      'Cumulative Layout Shift is a Core Web Vital. It is also why visitors tap the wrong thing.',
    )
  }

  if (vitals.h1Count === 0) {
    add(
      'heading-order',
      'high',
      'comprehension',
      'The page has no <h1>, so nothing declares what it is about',
      'Make the page\'s main title an <h1>, once, containing the thing the page is actually about.',
      'An assistant deciding whether a page answers a question reads the heading structure before the body.',
    )
  } else if (vitals.h1Count > 1) {
    add(
      'heading-order',
      'medium',
      'comprehension',
      `The page has ${vitals.h1Count} <h1> headings, so none of them is the subject`,
      'Keep one <h1> and demote the rest to <h2>.',
    )
  }

  const skipped = firstSkippedLevel(vitals.headingOrder)
  if (skipped) {
    add(
      'heading-order',
      'low',
      'comprehension',
      `Heading levels skip straight to <h${skipped}>, breaking the outline`,
      'Use heading levels in order. They describe structure, not size — set the size in CSS.',
    )
  }

  if (vitals.imagesMissingAlt > 0) {
    add(
      'image-alt',
      vitals.imagesMissingAlt > 5 ? 'medium' : 'low',
      'comprehension',
      `${vitals.imagesMissingAlt} of ${vitals.imagesTotal} images have no alt text`,
      'Describe what each image shows, in the words a customer would use. Leave alt="" only on purely decorative ones.',
      'Alt text is the only thing a text-only crawler or an assistant can read from an image.',
    )
  }

  if (vitals.vagueActions.length > 0) {
    add(
      'link-text',
      'medium',
      'comprehension',
      `${vitals.vagueActions.length} links or buttons name no destination: ${vitals.vagueActions.slice(0, 4).map((t) => `"${t}"`).join(', ')}`,
      'Say where it goes: "Book a repair", "See our Richmond prices", "Call for a same-day slot". The words in a link describe the page it points at, to a person and to a crawler alike.',
      'Anchor text is a ranking input for the destination page. "Click here" spends that on nothing.',
    )
  }

  if (vitals.bodyFontPx !== null && vitals.bodyFontPx < 16) {
    add(
      'text-size',
      'medium',
      'ranking',
      `Body text renders at ${vitals.bodyFontPx}px, below the 16px that phones can read without zooming`,
      'Set the body size to at least 16px (1rem) and let headings scale from it.',
      'Text too small to read is a mobile-usability fault, and readability is the presentation factor the GEO research measures directly.',
    )
  }

  if (vitals.lowContrast.length > 0) {
    const worst = vitals.lowContrast.reduce((a, b) => (a.ratio < b.ratio ? a : b))
    add(
      'contrast',
      worst.ratio < 3 ? 'medium' : 'low',
      'ranking',
      `Body text contrast is ${worst.ratio}:1, below the 4.5:1 minimum (${worst.color} on ${worst.background})`,
      'Darken the text or lighten the background until the ratio clears 4.5:1. Grey-on-white body copy is the usual cause.',
      'Contrast is scored by Lighthouse, which is the same accessibility audit Google surfaces in Search Console.',
    )
  }

  if (vitals.smallTapTargets.length > 0) {
    add(
      'tap-targets',
      'medium',
      'ranking',
      `${vitals.smallTapTargets.length} buttons or links are smaller than 44x44px, the size a thumb can hit`,
      `Give them more padding. The smallest is "${vitals.smallTapTargets[0].text}" at ${vitals.smallTapTargets[0].width}x${vitals.smallTapTargets[0].height}px.`,
      'Tap targets too close together is a mobile-usability fault Google reports.',
    )
  }

  if (vitals.unlabelledFields > 0) {
    add(
      'form-labels',
      'medium',
      'conversion',
      `${vitals.unlabelledFields} of ${vitals.formFields} form fields have no label`,
      'Give every field a visible <label for="…">. Placeholder text is not a label: it disappears the moment someone types.',
    )
  }

  if (vitals.formFields > 7) {
    add(
      'form-length',
      'low',
      'conversion',
      `The form asks for ${vitals.formFields} fields before anyone can send it`,
      'Cut it to name, phone and what they need. Every extra field is people who start and do not finish.',
    )
  }

  if (isHomepage && !vitals.hasTelLink) {
    add(
      'no-call-to-action',
      'high',
      'conversion',
      'The homepage has no tappable phone number',
      'Put the number in an <a href="tel:…"> near the top. On a phone it becomes one tap to call, and it is the first thing an assistant looks for when asked how to reach a business.',
    )
  }

  return out
}
