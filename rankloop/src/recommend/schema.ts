import type { Recommendation, RecommendInput, PageRow } from './types'
import { FILL } from './types'
import { isPlaceBasedClient, sellsProductsClient, type Client, type ClientLocation } from '../lib/client'
import type { ClientFacts } from '../onboard/questionnaire'
import { isLocalBusinessType, isProductType, mostSpecificBusinessType } from '../lib/schema-types'

/**
 * Generates JSON-LD structured data.
 *
 * Invisible to visitors and one of the strongest signals for being cited: it
 * states plainly what a page is, rather than leaving an engine to infer it. A
 * local business and an online store need entirely different types, so this
 * branches on business type rather than emitting one generic block.
 */

function locationFor(page: PageRow, locations: ClientLocation[]): ClientLocation | null {
  const haystack = `${page.slug} ${page.title}`.toLowerCase()
  return locations.find((l) => haystack.includes(l.name.toLowerCase())) ?? null
}

function offeringFor(page: PageRow, client: Client): string | null {
  const haystack = `${page.slug} ${page.title}`.toLowerCase()
  return (
    client.offerings
      .filter((o) => o.split(/\s+/).filter((w) => w.length > 3).every((w) => haystack.includes(w)))
      .sort((a, b) => b.length - a.length)[0] ?? null
  )
}

function localBusinessNode(
  client: Client,
  page: PageRow,
  location: ClientLocation | null,
  facts: ClientFacts,
) {
  const id = `${page.url.replace(/\/$/, '')}#business`
  return {
    '@type': 'LocalBusiness',
    '@id': id,
    name: client.name,
    url: client.homepageUrl,
    telephone: client.primaryPhone ?? FILL('phone number'),
    address: {
      '@type': 'PostalAddress',
      addressLocality: location?.name ?? FILL('city'),
      addressRegion: location?.region ?? FILL('state'),
      addressCountry: 'US',
      streetAddress:
        facts.street_address ??
        FILL('street address, or delete this line if you only travel to customers'),
      postalCode: facts.postal_code ?? FILL('ZIP code'),
    },
    ...(location
      ? { areaServed: [{ '@type': 'City', name: location.name }] }
      : {}),
    priceRange: facts.price_band ?? FILL('price range, e.g. $$'),
  }
}

function productNode(client: Client, page: PageRow, facts: ClientFacts) {
  return {
    '@type': 'Product',
    name: page.title.split(/[|–—]/)[0].trim() || page.slug.replace(/[-_]/g, ' '),
    url: page.url,
    brand: { '@type': 'Brand', name: client.name },
    description: page.metaDescription || FILL('one-sentence product description'),
    offers: {
      '@type': 'Offer',
      url: page.url,
      priceCurrency: facts.currency ?? FILL('currency code, e.g. USD'),
      price: FILL('price'),
      availability: 'https://schema.org/InStock',
    },
  }
}

function breadcrumbNode(page: PageRow) {
  let segments: string[] = []
  try {
    segments = new URL(page.url).pathname.split('/').filter(Boolean)
  } catch {
    return null
  }
  if (segments.length < 2) return null

  const origin = new URL(page.url).origin
  return {
    '@type': 'BreadcrumbList',
    itemListElement: segments.map((seg, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: seg.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      item: `${origin}/${segments.slice(0, i + 1).join('/')}/`,
    })),
  }
}

export function recommendSchema(input: RecommendInput): Recommendation[] {
  const { client, locations, pages, facts = {} } = input
  const out: Recommendation[] = []
  // Separate questions: a shop needs Product markup on what it sells *and*
  // LocalBusiness markup on the pages that place it somewhere.
  const wantsProduct = sellsProductsClient(client)
  const wantsPlace = isPlaceBasedClient(client)

  for (const page of pages) {
    const existing = JSON.parse(page.schemaTypes || '[]') as string[]
    const nodes: unknown[] = []
    const missing: string[] = []

    if (wantsProduct && page.pageType === 'product') {
      if (!existing.some(isProductType)) {
        nodes.push(productNode(client, page, facts))
        missing.push('Product')
      }
    } else if (wantsPlace) {
      /**
       * Only when there is no business markup at all. A page already marked up
       * as a LocalBusiness subtype — `LiquorStore`, `Dentist`, `AutoRepair` —
       * has the signal, and proposing a generic `LocalBusiness` alongside it
       * would talk the site down to a vaguer type than the one it chose.
       */
      if (!existing.some(isLocalBusinessType)) {
        nodes.push(localBusinessNode(client, page, locationFor(page, locations), facts))
        missing.push('LocalBusiness')
      }
      const offering = offeringFor(page, client)
      if (offering && !existing.includes('Service')) {
        nodes.push({
          '@type': 'Service',
          serviceType: offering.replace(/\b\w/g, (c) => c.toUpperCase()),
          provider: { '@id': `${page.url.replace(/\/$/, '')}#business` },
          ...(locationFor(page, locations)
            ? { areaServed: { '@type': 'City', name: locationFor(page, locations)!.name } }
            : {}),
        })
        missing.push('Service')
      }
    }

    if (!existing.includes('BreadcrumbList')) {
      const crumb = breadcrumbNode(page)
      if (crumb) {
        nodes.push(crumb)
        missing.push('BreadcrumbList')
      }
    }

    if (nodes.length === 0) continue

    out.push({
      pageId: page.id,
      kind: 'schema',
      target: page.url,
      currentValue: existing.length ? existing.join(', ') : null,
      proposedValue: JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }, null, 2),
      reason:
        `Missing ${missing.join(' and ')} structured data. This is invisible to visitors but tells search and AI engines ` +
        `exactly what this page is, which is one of the strongest signals for being cited. Paste inside a ` +
        `<script type="application/ld+json"> tag before </head>.` +
        // Said plainly, so nobody reads this as "replace what you have".
        (mostSpecificBusinessType(existing)
          ? ` The page already declares ${mostSpecificBusinessType(existing)}, which is more specific than LocalBusiness — keep it. This block is an addition, not a replacement.`
          : ''),
      priority: missing.includes('Product') || missing.includes('LocalBusiness') ? 76 : 52,
    })
  }

  return out
}
