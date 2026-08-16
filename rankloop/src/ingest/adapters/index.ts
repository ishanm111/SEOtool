import type { Client } from '../../lib/client'
import type { IngestAdapter } from './types'
import { wordpressAdapter } from './wordpress'
import { shopifyAdapter } from './shopify'
import { genericAdapter } from './generic'

export type { IngestAdapter, IngestedPage } from './types'

/**
 * Ordered most-specific first. The generic crawler claims to support everything,
 * so it must come last — it is the fallback, not the default.
 */
const ADAPTERS: IngestAdapter[] = [wordpressAdapter, shopifyAdapter, genericAdapter]

export function adapterFor(client: Client): IngestAdapter {
  const match = ADAPTERS.find((a) => a.supports(client))
  if (!match) throw new Error(`no ingest adapter can read ${client.domain}`)
  return match
}
