# RankLoop v2 — from one-client auditor to a real SEO tool

## STATUS: all 8 steps complete

| Step | State |
|---|---|
| 1. Multi-client database | ✅ 14 tables, zero hardcoding |
| 2. Auto-onboarding | ✅ URL → platform, type, places, offerings |
| 3. Ingest adapters | ✅ WordPress, Shopify, generic |
| 4. Prompt generation | ✅ both business types |
| 5. Recommendations engine | ✅ meta, copy, schema, new pages |
| 6. Type-aware findings + report | ✅ 5 ecommerce-only rules |
| 7. Dashboard switcher + review bar | ✅ 8 routes, cookie-backed |
| 8. Search Console reader | ✅ free OAuth, replaces paid volume data |

**Commands** — `npm run` : `migrate`, `add-client`, `ingest`, `prompts`, `login`, `measure`, `competitors`, `analyze`, `recommend`, `report`, `gsc-auth`, `gsc`.

**Search Console setup** (one time, free): create an OAuth client of type *Desktop app* at console.cloud.google.com, enable the Google Search Console API, put `GSC_CLIENT_ID` and `GSC_CLIENT_SECRET` in `.env.local`, then `npm run gsc-auth`.

**Known dead weight:** the `generated_pages` table is deprecated and orphaned — kept only so the phase-one backfill survives. New pages are `recommendations` rows with kind `new_page`.

---

## Context

The original brief said to build a tool that optimises **any** business's website for AI search, and to *start* with the appliance repair client as the first use case. The first build did that — but it stopped at the first use case. Everything is currently hardcoded to the pilot client in `src/config.ts`, and **13 files import from it**.

The tool needs to accept any client: a local service business with a Google Business Profile, or a Shopify store with no profile at all. You hand it a URL, it figures out the rest, and it returns SEO recommendations — **copy, metadata, schema and new pages. Never design changes.**

The pilot client becomes client #1 in the system rather than the system itself. No measured data is lost: the 39 AI answers, 34 findings, 11 crawled competitors and 8 generated pages all carry over.

### What already works and must be preserved

| Component | File | Status |
|---|---|---|
| Browser automation, 3 AI engines | `src/engines/browser.ts`, `chat-engines.ts` | Fully generic, reuse as-is |
| **Competitor mining** | `src/analysis/competitors.ts` | Fully generic, takes any domain |
| Content scoring (stats, readability, superlatives) | `src/ingest/score.ts` | Generic except `auditGeo()` |
| HTML → paragraphs | `src/ingest/split.ts` | Fully generic |
| Report generator | `src/report/template.ts` | Generic shape, hardcoded copy |
| DataForSEO adapter | `src/engines/dataforseo.ts` | Generic, optional |

### Decisions already made

- **Ecommerce stores are small** (~10 products) — so crawl everything, no sampling needed.
- **Recommendations cover all four types**: titles/meta/keywords, body copy rewrites, schema, and proposed new pages.
- **DataForSEO is NOT being bought, and the tool must work fully without it.**

### Why DataForSEO is deferred — and what replaces it

The instinct that a brand-new local client "has no data" is right, but it points the other way: the data that matters is about **competitors**, not the client. A new business has no rankings and no traffic, so competitive data is the *only* intelligence available. Everything useful found for the pilot client — the top rival's 9 mentions, the location-page pattern, the 31× statistics gap — came from competitors.

What DataForSEO uniquely provides is **location spoofing**: seeing Google results as though standing in the client's city. Browser automation always returns results for the operator's own IP, which breaks the moment a client is in a different city. That is the one genuinely irreplaceable feature — and it only starts to matter at roughly 3+ local clients.

**Therefore this build adds a manual-entry path instead.** A `competitive_bar` table per client + location holding the top 3 map-pack businesses with their ratings and review counts, entered by hand (10 minutes: Google "service + city", read the map pack, type in three rows). The findings engine consumes that table and never knows whether the numbers came from a human or an API. When DataForSEO is eventually wired in, it writes to the same table and nothing downstream changes.

TrendsPy was considered and rejected as a substitute: it returns a 0–100 relative popularity index with no map data, no ratings and no absolute search volumes. It is a keyword-brainstorming tool, not competitive intelligence.

**One DataForSEO account would cover every client** — it is pay-per-call against a single prepaid balance, not per-seat. Cost was never the objection; necessity was.

### Keyword volumes: use Search Console instead

Search volume feeds exactly one thing that matters — **which words go into the title tags, meta descriptions and collection copy**. For an ecommerce client, "fidget toy" versus "sensory fidget toy for anxiety" is a real decision with a real traffic difference, and it belongs in the recommendation.

But for sites you or the client already own, **Google Search Console gives the actual queries people used, with real impressions and clicks — free, and strictly better than estimated volume.** DataForSEO's volume data only wins for terms you do *not* yet rank for.

So this build adds **`src/engines/search-console.ts`** (free, OAuth) rather than paid volume data. Search Console access is part of client onboarding regardless, and for the operator's own Shopify stores it is available immediately. Shopify's own internal site-search analytics are a second free source for the same purpose.

---

## 1. Multi-client database

Add a `clients` table; add `clientId` to `pages`, `locations`, `prompts`, `findings`, `competitors`, `generatedPages`. `paragraphs`, `runs`, `mentions` and `citations` inherit through their parents.

```
clients
  id, name, domain, homepageUrl
  businessType   'local_service' | 'ecommerce'
  platform       'wordpress' | 'shopify' | 'webflow' | 'squarespace' | 'wix' | 'custom'
  apiBase        wp-json root, or myshopify domain, or null
  aliases        JSON — name variants for matching mentions in AI answers
  phones         JSON — every number found on the site
  primaryPhone
  gbpUrl, gbpRating, gbpReviewCount, gbpHasWebsite, gbpServiceArea   all nullable
  offerings      JSON — services, or product categories
  wrongGeoTerms  JSON — DERIVED per client, never hardcoded
  isActive, createdAt
```

`cities` is renamed to **`locations`** and gains `clientId`. Ecommerce clients simply have none.

**Delete from `src/config.ts`:** `CLIENT`, `CLIENT_GBP`, `SERVICE_AREA`, `METRO_ANCHOR`, `WRONG_STATE_TERMS`, `APPLIANCES`, `MANUAL_COMPETITORS`, `UNRESOLVED_COMPETITORS`. All become database rows.

**Keep in `config.ts`:** only `RATING_THRESHOLDS` — the per-engine star-rating floors are a property of the engines, not of any client.

Every function that currently imports `CLIENT` takes a `client` argument instead. This is the bulk of the mechanical work across the 13 importing files.

**Backfill migration** creates the pilot client as client #1 from the current constants and stamps `clientId = 1` on all existing rows.

---

## 2. Auto-onboarding — `src/onboard/detect.ts`

Input: a URL. Output: a populated `clients` row, for review before saving.

### Platform detection, in order
1. `/wp-json/` returns 200 → **WordPress** (record the API root)
2. HTML contains `cdn.shopify.com` or `/cdn/shop/`, or `/products.json` returns JSON → **Shopify**
3. `wf-page` / `webflow` in markup → **Webflow**
4. `squarespace.com` assets, `Static.SQUARESPACE_CONTEXT` → **Squarespace**
5. `wix.com` / `_wixCssIds` → **Wix**
6. Otherwise → **custom** (generic crawler)

### Business type classification
Score both sides from the homepage and sitemap; highest wins, ties resolved toward `local_service`:

**Ecommerce signals** — `Product`/`Offer` schema, `/products/` or `/collections/` URLs, cart or checkout links, price patterns, "add to cart"
**Local service signals** — `LocalBusiness` schema, a postal address, a phone in the header, "service area"/"we come to you", city-named pages, "book"/"appointment"/"call for a quote"

### Extraction
- **Name** — `Organization`/`LocalBusiness` schema name → `og:site_name` → `<title>`
- **Aliases** — generated automatically: strip punctuation, apostrophe variants, `&`↔`and`, concatenated form. *(This is what caught an apostrophe-vs-spaces mismatch in the pilot client's own name — automate it rather than hand-listing.)*
- **Phones** — every match on the site, deduplicated; the most frequent becomes `primaryPhone`
- **Locations** (local service) — from `areaServed` schema, city-named page slugs, and address; each mapped to a DataForSEO location string
- **Offerings** — service pages for local service; collections and product types for ecommerce
- **`wrongGeoTerms`** — derived, not hardcoded: collect every US place name mentioned on the site, subtract the confirmed service area, and flag the remainder. This finds a wrong-area problem on any client without anyone writing a place name in a file. Names shared between states are excluded automatically when they appear in the service area.

Run via `npx tsx src/scripts/add-client.ts <url>` — prints what it detected, asks for confirmation, then saves. A dashboard form comes later.

---

## 3. Ingest adapters — `src/ingest/adapters/`

Common interface so the rest of the pipeline never knows the platform:

```ts
type IngestedPage = {
  externalId?: number | string
  url: string; slug: string; title: string
  metaDescription: string; contentHtml: string
  schemaTypes: string[]
  pageType: 'page' | 'post' | 'product' | 'collection'
}
type IngestAdapter = { fetchAll(client: Client): Promise<IngestedPage[]> }
```

- **`wordpress.ts`** — exists; move behind the interface, take `apiBase` from the client row
- **`shopify.ts`** — `/products.json` (paginated), `/collections.json`, plus sitemap for pages. Product body HTML, titles and images all come back cleanly with no credentials.
- **`generic.ts`** — sitemap discovery with a homepage-link fallback, then fetch and parse each page. Reuses the sitemap logic already written in `src/analysis/competitors.ts` — extract it into `src/lib/sitemap.ts` and have both call it.

`splitContent()` and `score.ts` run unchanged on the output.

---

## 4. Prompt generation — `src/prompts/generate.ts`

Replaces the hand-written `src/seed/prompts.ts`.

### Local service
Per detected location × intent: **emergency**, **brand**, **price**, **comparison**, plus older-customer phrasing variants. Uses the client's detected services rather than a hardcoded appliance list. Roughly the same 36 the current set has, generated instead of typed.

### Ecommerce — different shape, no location terms
| Intent | Pattern |
|---|---|
| discovery | "best `<product type>` for `<use case>`" |
| comparison | "`<product>` vs `<alternative>`" |
| problem | "what helps with `<problem the product solves>`" |
| where-to-buy | "where to buy `<product>` online" |
| brand | "is `<brand>` any good" |
| quality | "best `<category>` under $X" |

Use cases and problems are inferred from product titles, descriptions and collection names. Every generated set is written to the DB and **shown for review before measuring** — same 5-minute human gate that exists today.

---

## 5. Recommendations engine — `src/recommend/`

The actual deliverable. Four generators, all writing to a new `recommendations` table (`clientId`, `pageId`, `kind`, `current`, `proposed`, `reason`, `priority`).

1. **`meta.ts`** — rewritten title (≤60 chars) and meta description (≤155) for every page, built from the page's real content plus the keywords it should target. Lowest risk: nothing visible on the page changes.
2. **`copy.ts`** — paragraph-level rewrites applying the GEO rules already implemented in `score.ts`: insert statistics, raise reading ease above 60, cut superlatives, put a direct answer in the first 100 words. **Every unverifiable claim emitted as a `[[FILL: ...]]` placeholder** — the rule that kept the 8 Virginia pages honest.
3. **`schema.ts`** — JSON-LD per page type: `LocalBusiness`/`Service`/`FAQPage` for local service, `Product`/`Offer`/`BreadcrumbList`/`FAQPage` for ecommerce.
4. **`newpages.ts`** — pages the site is missing. Local service: one per location (generalise `src/generate/city-page.ts`, which is currently appliance-specific). Ecommerce: collection pages and buying guides for the gaps competitor mining exposes.

**Hard rule, carried over:** never auto-generate claims about pricing, warranties, licensing, insurance or guarantees. Always a placeholder.

---

## 6. Findings and reports become type-aware

`buildFindings()` splits into shared rules plus two branches:

- **Shared** — statistics density, readability, superlatives, missing schema, thin content, duplicate pages, wrong-geography, AI visibility rate, the two-routes insight
- **Local service only** — Google Business Profile checks, review thresholds, NAP consistency, missing city pages
- **Ecommerce only** — product titles without descriptors, missing `Product` schema, thin product descriptions, no comparison or buying-guide content, missing review markup

`src/report/template.ts` swaps the local-service language for ecommerce equivalents and drops the Google Business Profile section entirely when there is no profile.

---

## 7. Dashboard

Client switcher in the header; every page filters by the selected client. Add `/clients` to list clients and onboard a new one. All existing screens keep working.

---

## Order of work

| # | Step | Time |
|---|---|---|
| 1 | `clients` table, `clientId` everywhere, backfill the pilot client, strip `config.ts` | 4 hrs |
| 2 | Auto-onboarding detection + `add-client.ts` | 5 hrs |
| 3 | Ingest adapters (Shopify, generic) + shared sitemap lib | 4 hrs |
| 4 | Prompt generation, both business types | 3 hrs |
| 5 | Recommendations engine, all four generators | 6 hrs |
| 6 | Type-aware findings and report | 3 hrs |
| 7 | Dashboard client switcher + competitive-bar entry form | 3 hrs |
| 8 | Google Search Console reader (free keyword data) | 3 hrs |

**About 3 days.** Steps 1–3 are the unblock; a Shopify store can be onboarded and measured after step 4.

### The `competitive_bar` table (replaces DataForSEO for now)

```
competitive_bar
  id, clientId, locationId
  rank            1 | 2 | 3   (map pack position)
  businessName
  rating          e.g. 4.8
  reviewCount     e.g. 212
  source          'manual' | 'dataforseo'
  capturedAt
```

Filled by hand from a Google search, or later by the API — the findings engine reads the table either way and cannot tell the difference. This is what turns "get more reviews" into "you need 212 reviews to match the leader; you have 2."

---

## Verification

1. **No regression:** after step 1, `npx tsx src/scripts/analyze.ts` still reports the pilot client at 0 of 39 with the same finding count. If that number moves, the backfill is wrong.
2. **Onboarding:** run `add-client.ts` against one of your Shopify stores → confirm it detects `shopify` + `ecommerce`, and pulls the real product list.
3. **Onboarding, second type:** run it against the pilot client's URL fresh → must detect `wordpress` + `local_service` and derive the wrong-area terms **without** them being in any file. This is the real test that hardcoding is gone.
4. **Ingest:** Shopify client's page count matches the store's actual products + collections + pages.
5. **Prompts:** generated ecommerce prompts contain **no city names**; generated local-service prompts contain the detected cities.
6. **Measure:** `measure.ts` runs against the Shopify client and returns answers naming real competitors.
7. **Recommendations:** every `[[FILL:` placeholder corresponds to a genuinely unverifiable claim — no invented prices, warranties or credentials.
8. **Isolation:** with two clients in the database, each dashboard page shows only the selected client's data.
9. **No DataForSEO dependency:** with `DATAFORSEO_LOGIN` unset, every script runs end-to-end and the report generates in full. Nothing may silently produce empty output because the API is absent.
10. `npx tsc --noEmit` clean throughout.

---

## Scope discipline — read before writing any code

**Build only what is in this document.** Nothing extra, however useful it seems mid-build.

The first phase drifted: it grew a competitor miner, a report generator and a page generator that were never planned, and it stayed on one client instead of generalising. Those turned out valuable, but they were unrequested, and the cost was that the actual product — a tool that works for any client — went unbuilt for a day.

Rules for this phase:

1. If something seems worth adding and is not in this document, **stop and ask** rather than building it.
2. Finish each numbered step before starting the next. No jumping ahead.
3. If a step turns out to need something unplanned to work at all, say so and get agreement first.
4. Nothing appliance-repair-specific, Virginia-specific, or the pilot client-specific may be written into code. Ever. Detection or database rows only.
5. When a step is done, state plainly what now works and what the next step is.

---

## Out of scope for this phase

Publishing to WordPress or Shopify (needs credentials), nightly scheduling, the experiment lab, and the on-page technical audit. All still on the roadmap in the phase-one plan (kept locally, not committed — it holds a real client's measured results).

---

## Note for whoever implements this

`rankloop/AGENTS.md` warns that this Next.js version differs from training data and to read `node_modules/next/dist/docs/` before writing Next-specific code. Steps 1–6 are almost entirely plain TypeScript; only step 7 touches Next patterns.
