/**
 * Google Search Console — free, and better than paid keyword-volume estimates
 * for any site you or the client owns.
 *
 * An estimate tells you what a term is worth in general. Search Console tells
 * you what people actually typed to reach this site, how often it was shown,
 * and where it ranked. That is the difference between a guess and a measurement.
 *
 * Implemented with plain fetch against the OAuth2 and Search Console REST
 * endpoints — no SDK, because the whole surface used here is three requests.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://searchconsole.googleapis.com/webmasters/v3'
export const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
/** Google's own value for the installed-app / manual-copy flow. */
export const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'

export type SearchQueryRow = {
  query: string
  page: string | null
  clicks: number
  impressions: number
  ctr: number
  position: number
}

function credentials() {
  const clientId = process.env.GSC_CLIENT_ID
  const clientSecret = process.env.GSC_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error(
      'GSC_CLIENT_ID / GSC_CLIENT_SECRET are not set in .env.local.\n' +
        'Create an OAuth client (type: Desktop app) at console.cloud.google.com, then run:\n' +
        '  npx tsx src/scripts/search-console-auth.ts',
    )
  }
  return { clientId, clientSecret }
}

export function authUrl(): string {
  const { clientId } = credentials()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    // Without this, a second authorisation returns no refresh token at all.
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeCode(code: string): Promise<string> {
  const { clientId, clientSecret } = credentials()
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: code.trim(),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  const json = (await res.json()) as { refresh_token?: string; error_description?: string; error?: string }
  if (!res.ok || !json.refresh_token) {
    throw new Error(`token exchange failed: ${json.error_description ?? json.error ?? res.status}`)
  }
  return json.refresh_token
}

async function accessToken(): Promise<string> {
  const { clientId, clientSecret } = credentials()
  const refresh = process.env.GSC_REFRESH_TOKEN
  if (!refresh) {
    throw new Error(
      'GSC_REFRESH_TOKEN is not set. Run: npx tsx src/scripts/search-console-auth.ts',
    )
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refresh,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  const json = (await res.json()) as { access_token?: string; error_description?: string }
  if (!res.ok || !json.access_token) {
    throw new Error(`could not refresh access token: ${json.error_description ?? res.status}`)
  }
  return json.access_token
}

/** Every property this Google account can read, so the right one can be picked. */
export async function listSites(): Promise<{ siteUrl: string; permissionLevel: string }[]> {
  const token = await accessToken()
  const res = await fetch(`${API}/sites`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`listing sites failed: HTTP ${res.status}`)
  const json = (await res.json()) as {
    siteEntry?: { siteUrl: string; permissionLevel: string }[]
  }
  return json.siteEntry ?? []
}

/**
 * Search Console keeps a rolling window and lags roughly two days, so a request
 * for "yesterday" legitimately returns nothing. Defaults look back 90 days and
 * stop three days short of today.
 */
export function defaultDateRange(days = 90): { startDate: string; endDate: string } {
  const end = new Date(Date.now() - 3 * 86_400_000)
  const start = new Date(end.getTime() - days * 86_400_000)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { startDate: iso(start), endDate: iso(end) }
}

export async function fetchQueries(
  siteUrl: string,
  opts: { startDate: string; endDate: string; byPage?: boolean; limit?: number } ,
): Promise<SearchQueryRow[]> {
  const token = await accessToken()
  const dimensions = opts.byPage ? ['query', 'page'] : ['query']

  const res = await fetch(`${API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      startDate: opts.startDate,
      endDate: opts.endDate,
      dimensions,
      rowLimit: opts.limit ?? 1000,
      dataState: 'all',
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Search Console query failed (HTTP ${res.status}): ${body.slice(0, 300)}`)
  }

  const json = (await res.json()) as {
    rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[]
  }

  return (json.rows ?? []).map((r) => ({
    query: r.keys[0] ?? '',
    page: opts.byPage ? (r.keys[1] ?? null) : null,
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }))
}

/**
 * Search Console properties come in two forms: a domain property
 * ("sc-domain:example.com") and a URL-prefix property
 * ("https://example.com/"). Which one exists is the account owner's choice, so
 * both are tried rather than guessed.
 */
export function candidateSiteUrls(domain: string, homepageUrl: string): string[] {
  const bare = domain.replace(/^www\./, '')
  return [
    `sc-domain:${bare}`,
    homepageUrl.endsWith('/') ? homepageUrl : `${homepageUrl}/`,
    `https://${bare}/`,
    `https://www.${bare}/`,
    `http://${bare}/`,
  ]
}
