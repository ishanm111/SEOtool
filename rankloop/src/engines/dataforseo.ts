import type { EngineResult } from './types'

const ENDPOINT = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced'

export type LocalPackEntry = {
  title: string
  rating: number | null
  ratingCount: number | null
  url: string | null
  position: number
}

export type GoogleResult = EngineResult & {
  aiOverviewText: string
  localPack: LocalPackEntry[]
  organic: { title: string; url: string; domain: string; position: number }[]
}

type DfsItem = {
  type?: string
  rank_absolute?: number
  title?: string
  url?: string
  domain?: string
  text?: string
  rating?: { value?: number; votes_count?: number }
  items?: DfsItem[]
  references?: Array<{ url?: string; domain?: string; title?: string }>
}

function auth(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) {
    throw new Error(
      'DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set. Add them to .env.local, ' +
        'or run measure with --skip-google.',
    )
  }
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64')
}

/** Flattens the nested AI Overview structure into plain text. */
function flattenAiOverview(item: DfsItem): string {
  const parts: string[] = []
  const walk = (node: DfsItem) => {
    if (node.text) parts.push(node.text)
    node.items?.forEach(walk)
  }
  walk(item)
  return parts.join('\n\n').trim()
}

/**
 * Asks Google for one keyword, targeted at a real city.
 *
 * Returns three things that matter:
 *  - the AI Overview box (the highest-value target, and the one thing browser
 *    automation cannot reliably scrape)
 *  - the local map pack WITH star ratings — this is how we learn the bar the
 *    client has to clear to be recommendable at all
 *  - the classic top 10
 */
export async function askGoogle(
  keyword: string,
  locationName: string,
  /** Broader location to retry against when the specific one is not recognised. */
  fallbackLocation?: string,
): Promise<GoogleResult> {
  const empty: GoogleResult = {
    engine: 'google_aio',
    answerText: '',
    aiOverviewText: '',
    citations: [],
    localPack: [],
    organic: [],
    ok: false,
  }

  const body = [
    {
      keyword,
      location_name: locationName,
      language_code: 'en',
      device: 'desktop',
      os: 'macos',
      depth: 20,
      load_async_ai_overview: true,
      people_also_ask_click_depth: 0,
    },
  ]

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: auth(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`)

    const json = (await res.json()) as {
      tasks?: Array<{
        status_code?: number
        status_message?: string
        result?: Array<{ items?: DfsItem[] }>
      }>
    }

    const task = json.tasks?.[0]
    if (!task) throw new Error('no task in response')

    // 40501 = location not found. Small localities often are not; retry broader.
    if (task.status_code === 40501 && fallbackLocation && fallbackLocation !== locationName) {
      return askGoogle(keyword, fallbackLocation)
    }
    if (task.status_code !== 20000) {
      throw new Error(`task ${task.status_code}: ${task.status_message}`)
    }

    const items = task.result?.[0]?.items ?? []

    const aio = items.find((i) => i.type === 'ai_overview')
    const aiOverviewText = aio ? flattenAiOverview(aio) : ''

    const citations = (aio?.references ?? [])
      .map((r, i) => ({ url: r.url ?? '', position: i + 1 }))
      .filter((c) => c.url)

    const localPack: LocalPackEntry[] = items
      .filter((i) => i.type === 'local_pack')
      .map((i, idx) => ({
        title: i.title ?? '',
        rating: i.rating?.value ?? null,
        ratingCount: i.rating?.votes_count ?? null,
        url: i.url ?? null,
        position: i.rank_absolute ?? idx + 1,
      }))

    const organic = items
      .filter((i) => i.type === 'organic')
      .map((i, idx) => ({
        title: i.title ?? '',
        url: i.url ?? '',
        domain: i.domain ?? '',
        position: i.rank_absolute ?? idx + 1,
      }))

    return {
      engine: 'google_aio',
      answerText: aiOverviewText,
      aiOverviewText,
      citations,
      localPack,
      organic,
      raw: { itemTypes: [...new Set(items.map((i) => i.type))] },
      ok: true,
    }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) }
  }
}
