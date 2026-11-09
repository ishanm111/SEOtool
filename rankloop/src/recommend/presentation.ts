import type { PageVitals } from '../analysis/presentation'
import type { Recommendation } from './types'
import { FILL } from './types'

/**
 * Turns a presentation audit into changes somebody can publish.
 *
 * The rest of this directory builds recommendations out of stored HTML. These
 * come out of the browser pass instead, because the faults they answer do not
 * exist until the page has painted — and because only four of the thirteen
 * things that pass measures have a single correct edit behind them.
 *
 * The other nine stay advice on the Findings screen on purpose. Contrast, tap
 * targets, layout shift and the largest paint are all fixed by a CSS decision a
 * person makes: there is no one value to write, and a tool that proposed one
 * would be proposing a design. The line is drawn at "is there exactly one right
 * answer", not at "could we generate something plausible".
 *
 * ## Nothing here is invented
 *
 * The hard part is alt text and link wording, because the obvious way to write
 * either is to guess from the business — "iPhone screen repair in Fairfax"
 * reads well and may describe an entirely different photograph. So every
 * proposal is *quoted* from somewhere on the page, and the reason says where it
 * was quoted from. When the page offers nothing to quote, the proposal is a
 * visible gap that blocks publishing rather than a sentence that reads well.
 */

/**
 * The kinds this module produces.
 *
 * The same problem `PRESENTATION_CATEGORIES` solves for findings: `recommend`
 * clears a client's recommendations before rebuilding them, and these are
 * written by a different pass. Without a list of what belongs to whom, running
 * the fix list would silently delete every presentation fix.
 */
export const PRESENTATION_KINDS = ['image_alt', 'link_text', 'heading', 'viewport'] as const

/** A page already read from the client's own site, so a link can be named. */
export type DestinationPage = { url: string; title: string }

export const VIEWPORT_TAG = '<meta name="viewport" content="width=device-width, initial-scale=1">'

/** Everything after the site's own name, which is not what the page is about. */
function headline(title: string): string {
  const first = title.split(/\s[|•·–—]\s|\s-\s/)[0]?.trim() ?? ''
  return first || title.trim()
}

const fileName = (src: string) => src.split(/[?#]/)[0].split('/').pop() || src

/** A camera's or an export tool's own naming, which describes nothing. */
const MACHINE_NAME = /^(img|image|dsc|dscn|photo|pxl|screen ?shot|untitled|final|copy|download|unnamed|logo)( \d*)?$/i

/**
 * The image's file name as words, or null when it is not words.
 *
 * Sites name their uploads after what is in them far more often than not, and
 * that name is text the site itself wrote. It is still the weakest of the three
 * sources, so it is the last one tried and the proposal says where it came
 * from. Anything that looks like a hash, an id or a camera's output is rejected
 * outright — falling through to a gap the business fills is the safe side of
 * this decision, and a plausible-looking wrong description is the unsafe one.
 */
function wordsFromFileName(rawSrc: string): string | null {
  const stem = fileName(rawSrc).replace(/\.[a-z0-9]{2,5}$/i, '')
  const words = stem
    // WordPress keeps resized copies as name-1024x768.jpg; the size is not a word.
    .replace(/[-_]?\d{2,5}x\d{2,5}$/i, '')
    .replace(/[-_](scaled|copy|final|edited|\d+)$/i, '')
    .replace(/%20/g, ' ')
    .replace(/[-_+.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!words) return null
  const parts = words.split(' ')
  if (parts.length < 2) return null
  if (MACHINE_NAME.test(words)) return null
  // A vowel-less or very long run is an id or a hash, not a word.
  if (parts.some((w) => /^\d+$/.test(w) || w.length > 20 || !/[aeiouy]/i.test(w))) return null
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Compares two addresses as the same page, ignoring what never changes one. */
function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const url = new URL(u)
      return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}`.toLowerCase()
    } catch {
      return u.replace(/\/+$/, '').toLowerCase()
    }
  }
  return norm(a) === norm(b)
}

const telFrom = (href: string) => (/^tel:/i.test(href) ? href.replace(/^tel:/i, '').trim() : null)
const mailFrom = (href: string) =>
  /^mailto:/i.test(href) ? href.replace(/^mailto:/i, '').split('?')[0].trim() : null

/**
 * Builds the publishable changes for one audited page.
 *
 * `destinations` is the client's own site as already read, which is what lets a
 * "Read more" be renamed after the page it actually points at rather than after
 * a guess at what it might be for.
 */
export function presentationRecommendations(
  vitals: PageVitals,
  page: { id: number; url: string },
  destinations: DestinationPage[],
): Recommendation[] {
  const out: Recommendation[] = []

  for (const image of vitals.altless) {
    /**
     * A link's wording only counts when it is a label.
     *
     * An image inside a link is usually a card — a blog teaser, a product tile
     * — and that link's text is the whole card: a date, a headline and the
     * first line of the body. Quoting it verbatim produced alt attributes
     * running to three lines and cut off mid-word, which is worse than none. A
     * run that long is a block of content rather than a name for the picture,
     * so it is left alone and the file name is tried instead.
     */
    const label = image.linkText.length > 0 && image.linkText.length <= 60 ? image.linkText : ''
    const quoted = image.caption
      ? { text: image.caption, from: 'the caption printed beside it' }
      : label
        ? { text: label, from: 'the wording of the link it sits inside' }
        : null
    const fromFileName = quoted ? null : wordsFromFileName(image.rawSrc)

    const where = quoted
      ? `Taken from ${quoted.from}, so it is wording already on the page.`
      : fromFileName
        ? 'Taken from the image’s own file name — read it once to check it describes the picture.'
        : 'Nothing beside this image describes it, so there is nothing to quote. Only somebody who can see the picture can write this.'

    out.push({
      pageId: page.id,
      kind: 'image_alt',
      target: `Image on ${page.url} — ${fileName(image.rawSrc)}`,
      locator: image.rawSrc,
      currentValue: null,
      proposedValue:
        quoted?.text ?? fromFileName ?? FILL(`what this image shows — ${fileName(image.rawSrc)}`),
      reason: `This image has no alt text, so a text-only crawler and an assistant read nothing from it at all. ${where}`,
      priority: 44,
    })
  }

  for (const link of vitals.vagueLinks) {
    const tel = telFrom(link.rawHref)
    const mail = mailFrom(link.rawHref)
    const destination = destinations.find((d) => sameUrl(d.url, link.href))
    const named = destination?.title ? headline(destination.title) : null

    const proposal = tel
      ? { text: `Call ${tel}`, where: 'The number is the one in the link itself.' }
      : mail
        ? { text: `Email ${mail}`, where: 'The address is the one in the link itself.' }
        : named
          ? {
              text: named,
              where: `Named after the page it points at, which is titled “${named}”.`,
            }
          : null

    out.push({
      pageId: page.id,
      kind: 'link_text',
      target: `Link on ${page.url} → ${link.href}`,
      locator: link.rawHref,
      currentValue: link.text,
      proposedValue:
        proposal?.text ?? FILL(`what is at ${link.href}, in three or four words`),
      reason:
        `“${link.text}” names nothing, so the words in this link describe neither the page ` +
        `it points at nor what happens next. Anchor text is a ranking input for the ` +
        `destination page, and this spends it on nothing. ` +
        (proposal?.where ??
          'The destination is not one of the pages read from this site, so nothing here says what it is.'),
      priority: 56,
    })
  }

  /**
   * Only the missing-h1 case becomes a change.
   *
   * Two h1s and a skipped level are real faults and stay on the Findings
   * screen, but neither has one correct edit: which of two h1s is the subject,
   * and which of the headings under a skipped level should move, are judgements
   * about what the page is for.
   */
  if (vitals.h1Count === 0) {
    const subject = vitals.firstH2 || headline(vitals.documentTitle)
    if (subject) {
      out.push({
        pageId: page.id,
        kind: 'heading',
        target: page.url,
        locator: null,
        currentValue: null,
        proposedValue: `<h1>${subject}</h1>`,
        reason:
          'The page has no <h1>, so nothing on it declares what it is about, and the heading ' +
          'structure is the first thing an assistant reads. ' +
          (vitals.firstH2
            ? 'Taken from the page’s own first subheading.'
            : 'Taken from the page’s own browser-tab title.'),
        priority: 66,
      })
    }
  }

  if (!vitals.hasViewportMeta) {
    out.push({
      pageId: page.id,
      kind: 'viewport',
      target: page.url,
      locator: null,
      currentValue: null,
      proposedValue: VIEWPORT_TAG,
      reason:
        'The page has no viewport tag, so phones render it at desktop width and zoom out. ' +
        'Google indexes the mobile rendering of a page first, and without this tag that ' +
        'rendering is a shrunken desktop one.',
      priority: 80,
    })
  } else if (vitals.viewportContent && !/width\s*=\s*device-width/i.test(vitals.viewportContent)) {
    out.push({
      pageId: page.id,
      kind: 'viewport',
      target: page.url,
      locator: null,
      currentValue: `<meta name="viewport" content="${vitals.viewportContent}">`,
      proposedValue: VIEWPORT_TAG,
      reason:
        'The viewport tag does not set width=device-width, so the page is laid out at a width ' +
        'no phone has.',
      priority: 80,
    })
  }

  return out
}
