/**
 * Sitemap discovery, shared by onboarding, the ingest adapters and the
 * competitor crawler. Extracted so all three agree on what a site's page list
 * is — they were drifting apart when each had its own copy.
 */

export const UA = 'SEOmyze/0.2 (SEO audit; respects robots)'

const SITEMAP_CANDIDATES = [
  '/sitemap_index.xml',
  '/sitemap.xml',
  '/wp-sitemap.xml',
  '/sitemap-index.xml',
  '/page-sitemap.xml',
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function get(url: string, timeoutMs = 20000): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal, redirect: 'follow' })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

export async function getJson<T>(url: string, timeoutMs = 20000): Promise<T | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: ctrl.signal,
      redirect: 'follow',
    })
    clearTimeout(t)
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('json')) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** Follows sitemap-index files one level down to reach the real URL lists. */
export async function collectSitemapUrls(origin: string, maxChildren = 8): Promise<string[]> {
  const urls = new Set<string>()

  for (const path of SITEMAP_CANDIDATES) {
    const xml = await get(origin + path)
    if (!xml) continue

    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1])
    const nested = locs.filter((u) => /\.xml($|\?)/i.test(u))
    const pages = locs.filter((u) => !/\.xml($|\?)/i.test(u))

    pages.forEach((u) => urls.add(u))

    for (const child of nested.slice(0, maxChildren)) {
      const childXml = await get(child)
      if (!childXml) continue
      for (const m of childXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        if (!/\.xml($|\?)/i.test(m[1])) urls.add(m[1])
      }
      await sleep(250)
    }

    if (urls.size > 0) break
  }

  // Sitemaps in the wild contain relative paths and malformed entries. Callers
  // parse these with `new URL()`, which throws, so filter them out here once
  // rather than defensively at every call site.
  return [...urls].filter((u) => {
    try {
      const parsed = new URL(u)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  })
}

/**
 * Fallback for sites with no sitemap — common on small hand-built sites. An
 * undercount, but far better than reporting zero pages and silently dropping a
 * site from the comparison.
 */
export function linksFromHtml(html: string, origin: string, domain: string): string[] {
  const found = new Set<string>()
  for (const m of html.matchAll(/href=["']([^"']+)["']/g)) {
    const href = m[1]
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue
    try {
      const abs = new URL(href, origin)
      if (abs.hostname.replace(/^www\./, '') !== domain.replace(/^www\./, '')) continue
      if (/\.(jpg|jpeg|png|gif|svg|pdf|zip|webp|ico|css|js)$/i.test(abs.pathname)) continue
      abs.hash = ''
      abs.search = ''
      found.add(abs.toString().replace(/\/$/, ''))
    } catch {
      // malformed href — skip
    }
  }
  return [...found]
}

export function originOf(input: string): { origin: string; domain: string } {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`
  const u = new URL(withProtocol)
  return { origin: u.origin, domain: u.hostname.replace(/^www\./, '') }
}
