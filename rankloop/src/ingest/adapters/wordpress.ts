import type { Client } from '../../lib/client'
import { UA } from '../../lib/sitemap'
import type { IngestAdapter, IngestedPage } from './types'

type RawWpPage = {
  id: number
  slug: string
  link: string
  title?: { rendered?: string }
  content?: { rendered?: string }
  yoast_head_json?: {
    title?: string
    description?: string
    schema?: { '@graph'?: Array<{ '@type'?: string | string[] }> }
  }
}

function collectSchemaTypes(page: RawWpPage): string[] {
  const graph = page.yoast_head_json?.schema?.['@graph'] ?? []
  const types = new Set<string>()
  for (const node of graph) {
    const t = node['@type']
    if (typeof t === 'string') types.add(t)
    else if (Array.isArray(t)) t.forEach((x) => types.add(x))
  }
  return [...types].sort()
}

/**
 * WordPress exposes a public REST API on almost every install, which returns
 * clean content with no credentials and no HTML scraping.
 */
export const wordpressAdapter: IngestAdapter = {
  name: 'wordpress',

  supports: (client) => client.platform === 'wordpress' && !!client.apiBase,

  async fetchAll(client, onProgress) {
    if (!client.apiBase) throw new Error(`${client.domain} has no API base recorded`)
    const out: IngestedPage[] = []

    for (const type of ['pages', 'posts'] as const) {
      for (let page = 1; page <= 10; page++) {
        const url = `${client.apiBase}/${type}?per_page=100&page=${page}&_fields=id,slug,link,title,content,yoast_head_json`
        const res = await fetch(url, { headers: { 'user-agent': UA } })

        // WordPress returns 400 once you page past the end.
        if (res.status === 400 || res.status === 404) break
        if (!res.ok) throw new Error(`${type} page ${page}: HTTP ${res.status}`)

        const batch = (await res.json()) as RawWpPage[]
        if (!Array.isArray(batch) || batch.length === 0) break

        for (const p of batch) {
          out.push({
            externalId: String(p.id),
            url: p.link,
            slug: p.slug,
            title: p.yoast_head_json?.title ?? p.title?.rendered ?? '',
            metaDescription: p.yoast_head_json?.description ?? '',
            contentHtml: p.content?.rendered ?? '',
            schemaTypes: collectSchemaTypes(p),
            pageType: type === 'posts' ? 'post' : 'page',
          })
        }

        onProgress?.(`${type}: ${out.length} so far`)
        if (batch.length < 100) break
      }
    }

    return out
  },
}
