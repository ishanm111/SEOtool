import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core'

const now = () => new Date()

/**
 * Every client the tool tracks. Nothing about a specific business may live in
 * code — it all lands here, filled by detection in src/onboard/detect.ts.
 *
 * The two business types are handled differently throughout the pipeline:
 * a local service business is judged on locations, reviews and a Google
 * Business Profile; an online store on products, categories and comparisons.
 */
export const clients = sqliteTable('clients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  domain: text('domain').notNull(),
  homepageUrl: text('homepage_url').notNull(),

  businessType: text('business_type').notNull().default('local_service'),
  platform: text('platform').notNull().default('custom'),
  /** WordPress wp-json root, or a Shopify origin. Null for generic crawls. */
  apiBase: text('api_base'),

  /** Name variants for matching mentions in AI answers. Generated, not typed. */
  aliases: text('aliases').notNull().default('[]'),
  /** Every phone number found on the site. More than one is itself a finding. */
  phones: text('phones').notNull().default('[]'),
  primaryPhone: text('primary_phone'),

  /** Google Business Profile. All null for a business without one. */
  gbpUrl: text('gbp_url'),
  gbpRating: real('gbp_rating'),
  gbpReviewCount: integer('gbp_review_count'),
  gbpHasWebsite: integer('gbp_has_website', { mode: 'boolean' }),
  gbpServiceArea: text('gbp_service_area'),

  /** Services for a local business, product categories for a store. */
  offerings: text('offerings').notNull().default('[]'),
  /**
   * Place names the site mentions that are NOT in its service area — derived per
   * client during onboarding, never hardcoded. This is what catches a site built
   * for one state while the business operates in another.
   */
  wrongGeoTerms: text('wrong_geo_terms').notNull().default('[]'),

  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(now),
})

/** Towns a local service client covers. An online store simply has none. */
export const locations = sqliteTable('locations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: integer('client_id').notNull().references(() => clients.id),
  name: text('name').notNull(),
  region: text('region').notNull().default(''),
  metro: text('metro').notNull().default(''),
  /** Exact string DataForSEO expects, if it is ever wired in. */
  dataforseoLocation: text('dataforseo_location').notNull().default(''),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
})

/**
 * The bar a client has to clear: the top three businesses in the local map pack,
 * with their ratings and review counts.
 *
 * Filled by hand from a Google search, or by an API later — the findings engine
 * reads the same rows either way and cannot tell the difference. This is what
 * turns "get more reviews" into "you need 212 to match the leader; you have 2".
 */
export const competitiveBar = sqliteTable('competitive_bar', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: integer('client_id').notNull().references(() => clients.id),
  locationId: integer('location_id').references(() => locations.id),
  rank: integer('rank').notNull().default(1),
  businessName: text('business_name').notNull(),
  rating: real('rating'),
  reviewCount: integer('review_count'),
  source: text('source').notNull().default('manual'),
  capturedAt: integer('captured_at', { mode: 'timestamp' }).$defaultFn(now),
})

/** One row per page pulled from the client's site, whatever the platform. */
export const pages = sqliteTable('pages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: integer('client_id').notNull().references(() => clients.id),
  /** Platform's own id — WordPress post id, Shopify product id, or null. */
  externalId: text('external_id'),
  url: text('url').notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull().default(''),
  metaDescription: text('meta_description').notNull().default(''),
  text: text('text').notNull().default(''),
  wordCount: integer('word_count').notNull().default(0),
  /**
   * Words the page actually serves as HTML, before any structured-data
   * fallback. Zero here with a non-zero wordCount means a page whose copy is
   * assembled in the browser: what a crawler that does not run JavaScript sees.
   */
  renderedWordCount: integer('rendered_word_count').notNull().default(0),
  schemaTypes: text('schema_types').notNull().default('[]'),
  /** page | post | product | collection */
  pageType: text('page_type').notNull().default('page'),
  /** Wrong-geography audit, using the client's own derived term list. */
  geoRefs: text('geo_refs').notNull().default('[]'),
  wrongGeoHits: integer('wrong_geo_hits').notNull().default(0),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).$defaultFn(now),
})

export const paragraphs = sqliteTable('paragraphs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pageId: integer('page_id').notNull().references(() => pages.id),
  sortOrder: integer('sort_order').notNull().default(0),
  heading: text('heading').notNull().default(''),
  text: text('text').notNull(),
  wordCount: integer('word_count').notNull().default(0),
  // GEO-paper signals: statistics and citations are the biggest measured lever.
  statCount: integer('stat_count').notNull().default(0),
  hasCitation: integer('has_citation', { mode: 'boolean' }).notNull().default(false),
  superlativeCount: integer('superlative_count').notNull().default(0),
  readability: real('readability').notNull().default(0),
})

export const prompts = sqliteTable('prompts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: integer('client_id').notNull().references(() => clients.id),
  /** Null for an online store — those questions carry no location. */
  locationId: integer('location_id').references(() => locations.id),
  text: text('text').notNull(),
  intent: text('intent').notNull().default('comparison'),
  persona: text('persona').notNull().default('general'),
  /** Fast subset for a quick sweep instead of the full set. */
  isCore: integer('is_core', { mode: 'boolean' }).notNull().default(false),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
})

/** One row per (prompt, engine) ask. Screenshot is the proof we show clients. */
export const runs = sqliteTable('runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  promptId: integer('prompt_id').notNull().references(() => prompts.id),
  engine: text('engine').notNull(),
  answerText: text('answer_text').notNull().default(''),
  screenshotPath: text('screenshot_path'),
  rawPayload: text('raw_payload'),
  ok: integer('ok', { mode: 'boolean' }).notNull().default(true),
  error: text('error'),
  runAt: integer('run_at', { mode: 'timestamp' }).$defaultFn(now),
})

export const mentions = sqliteTable('mentions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull().references(() => runs.id),
  businessName: text('business_name').notNull(),
  isClient: integer('is_client', { mode: 'boolean' }).notNull().default(false),
  position: integer('position').notNull().default(0),
  snippet: text('snippet').notNull().default(''),
})

export const citations = sqliteTable('citations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull().references(() => runs.id),
  url: text('url').notNull(),
  domain: text('domain').notNull(),
  isClientDomain: integer('is_client_domain', { mode: 'boolean' }).notNull().default(false),
  position: integer('position').notNull().default(0),
})

export const findings = sqliteTable('findings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: integer('client_id').notNull().references(() => clients.id),
  targetType: text('target_type').notNull(),
  targetId: integer('target_id'),
  category: text('category').notNull(),
  severity: text('severity').notNull().default('medium'),
  issue: text('issue').notNull(),
  currentText: text('current_text'),
  proposedText: text('proposed_text'),
  evidence: text('evidence'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(now),
})

/**
 * The businesses AI recommends instead of the client, and what their sites do
 * differently. Built by crawling the exact URLs the engines cited.
 */
export const competitors = sqliteTable('competitors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: integer('client_id').notNull().references(() => clients.id),
  domain: text('domain').notNull(),
  name: text('name').notNull().default(''),
  citationCount: integer('citation_count').notNull().default(0),
  mentionCount: integer('mention_count').notNull().default(0),

  pageCount: integer('page_count').notNull().default(0),
  cityPageCount: integer('city_page_count').notNull().default(0),
  cityPages: text('city_pages').notNull().default('[]'),
  schemaTypes: text('schema_types').notNull().default('[]'),
  hasLocalBusiness: integer('has_local_business', { mode: 'boolean' }).notNull().default(false),
  hasFaqSchema: integer('has_faq_schema', { mode: 'boolean' }).notNull().default(false),
  faqBlockCount: integer('faq_block_count').notNull().default(0),

  avgReadability: real('avg_readability').notNull().default(0),
  statsPerThousand: real('stats_per_thousand').notNull().default(0),
  superlativeCount: integer('superlative_count').notNull().default(0),
  sampleWordCount: integer('sample_word_count').notNull().default(0),

  phones: text('phones').notNull().default('[]'),
  /** Sitemap is authoritative; homepage-links undercounts and is labelled. */
  discoveredVia: text('discovered_via').notNull().default('sitemap'),
  /** A national chain skews averages — excluded from the local comparison. */
  isNational: integer('is_national', { mode: 'boolean' }).notNull().default(false),
  crawledAt: integer('crawled_at', { mode: 'timestamp' }).$defaultFn(now),
  ok: integer('ok', { mode: 'boolean' }).notNull().default(true),
  error: text('error'),
})

/**
 * The deliverable: what to change, page by page. Never design — copy, metadata,
 * structured data, and whole pages the site is missing.
 */
export const recommendations = sqliteTable('recommendations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: integer('client_id').notNull().references(() => clients.id),
  /** Null when the recommendation is a brand-new page rather than an edit. */
  pageId: integer('page_id').references(() => pages.id),
  /** meta_title | meta_description | copy | schema | new_page | blog_post */
  kind: text('kind').notNull(),
  target: text('target').notNull().default(''),
  currentValue: text('current_value'),
  proposedValue: text('proposed_value').notNull(),
  reason: text('reason').notNull().default(''),
  priority: integer('priority').notNull().default(50),
  /** Count of [[FILL: ...]] markers the client must resolve before publishing. */
  placeholderCount: integer('placeholder_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(now),
})

/**
 * Real search queries from Google Search Console.
 *
 * The honest alternative to paid keyword-volume estimates: these are the terms
 * people actually used to reach the site, with real impressions and positions.
 * Free, and strictly better than an estimate — but only available for a site the
 * operator or client verifiably owns.
 */
export const searchQueries = sqliteTable('search_queries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: integer('client_id').notNull().references(() => clients.id),
  query: text('query').notNull(),
  /** Null when the row is aggregated across the whole site. */
  page: text('page'),
  clicks: integer('clicks').notNull().default(0),
  impressions: integer('impressions').notNull().default(0),
  ctr: real('ctr').notNull().default(0),
  position: real('position').notNull().default(0),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).$defaultFn(now),
})

/**
 * DEPRECATED — retained only so the phase-one backfill is not lost.
 *
 * Nothing reads or writes this any more. Pages the site is missing are now
 * `recommendations` rows with kind `new_page`, which carry a reason and a
 * priority alongside the content. Safe to drop once the old rows are no longer
 * wanted.
 */
export const generatedPages = sqliteTable('generated_pages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: integer('client_id').notNull().references(() => clients.id),
  locationId: integer('location_id').references(() => locations.id),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  metaDescription: text('meta_description').notNull().default(''),
  h1: text('h1').notNull(),
  bodyHtml: text('body_html').notNull(),
  schemaJson: text('schema_json').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(now),
})

/**
 * One press of "Start a new run": the ordered pipeline for a single client.
 *
 * A run is a row rather than a background variable so it survives a server
 * restart. A page that reports "running" from memory alone would keep saying so
 * forever once the process behind it had gone.
 */
export const pipelineRuns = sqliteTable('pipeline_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: integer('client_id').notNull().references(() => clients.id),
  label: text('label').notNull().default(''),
  /** queued | running | done | failed | cancelled */
  status: text('status').notNull().default('queued'),
  /** The steps asked for, in order, as JSON. Skipped steps still appear. */
  stepKeys: text('step_keys').notNull().default('[]'),
  error: text('error'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(now),
})

/** One stage of a run, with the output it produced kept for the operator. */
export const pipelineSteps = sqliteTable('pipeline_steps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull().references(() => pipelineRuns.id),
  stepKey: text('step_key').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  /** pending | running | done | failed | skipped */
  status: text('status').notNull().default('pending'),
  log: text('log').notNull().default(''),
  exitCode: integer('exit_code'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
})

/**
 * How to write to a client's own site, so an approved fix can be published
 * rather than copied out by hand.
 *
 * The secret is an application password or an API token — never the client's
 * own login — so it can be revoked from their side without touching anything
 * else they own.
 */
export const siteCredentials = sqliteTable('site_credentials', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: integer('client_id').notNull().references(() => clients.id),
  /** wordpress | shopify */
  kind: text('kind').notNull(),
  endpoint: text('endpoint').notNull().default(''),
  username: text('username').notNull().default(''),
  secret: text('secret').notNull().default(''),
  /** untested | ok | failed */
  status: text('status').notNull().default('untested'),
  detail: text('detail'),
  checkedAt: integer('checked_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(now),
})

/**
 * Every change written to a client's live site, with the value that was there
 * before it.
 *
 * Recording the previous value is what makes an edit undoable. Without it the
 * tool could publish a change it has no way to take back, which is not a
 * position to put an operator in on someone else's website.
 */
export const fixApplications = sqliteTable('fix_applications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: integer('client_id').notNull().references(() => clients.id),
  recommendationId: integer('recommendation_id'),
  pageId: integer('page_id'),
  targetUrl: text('target_url').notNull().default(''),
  field: text('field').notNull().default(''),
  previousValue: text('previous_value'),
  appliedValue: text('applied_value').notNull().default(''),
  /** applied | reverted | failed */
  status: text('status').notNull().default('applied'),
  error: text('error'),
  appliedAt: integer('applied_at', { mode: 'timestamp' }).$defaultFn(now),
})

/**
 * What the numbers were when a run finished.
 *
 * Written once, at the end of a run, and never recomputed. The dashboard always
 * shows the present; this is the only place that remembers the past, so "we were
 * named in 0 of 128 answers in September" survives every later run, every
 * re-crawl and every edit to the site. Recomputing it from live tables would
 * quietly rewrite history each time anything changed.
 */
export const runResults = sqliteTable('run_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull().references(() => pipelineRuns.id),
  clientId: integer('client_id').notNull().references(() => clients.id),
  capturedAt: integer('captured_at', { mode: 'timestamp' }).$defaultFn(now),

  answersTotal: integer('answers_total').notNull().default(0),
  answersNamed: integer('answers_named').notNull().default(0),
  namedPct: real('named_pct').notNull().default(0),
  promptsTotal: integer('prompts_total').notNull().default(0),

  pagesRead: integer('pages_read').notNull().default(0),
  wrongGeoPages: integer('wrong_geo_pages').notNull().default(0),

  findingsTotal: integer('findings_total').notNull().default(0),
  findingsCritical: integer('findings_critical').notNull().default(0),

  recommendationsTotal: integer('recommendations_total').notNull().default(0),
  /** Recommendations still carrying a value only the business can confirm. */
  recommendationsBlocked: integer('recommendations_blocked').notNull().default(0),

  competitorsTotal: integer('competitors_total').notNull().default(0),
  fixesPublished: integer('fixes_published').notNull().default(0),

  gbpRating: real('gbp_rating'),
  gbpReviewCount: integer('gbp_review_count'),

  /** The exact file this run produced, so an old report stays reachable. */
  reportPath: text('report_path'),

  byEngine: text('by_engine').notNull().default('[]'),
  byMarket: text('by_market').notNull().default('[]'),
  topCompetitors: text('top_competitors').notNull().default('[]'),
})

/**
 * Answers to the intake questionnaire: the things only the business can tell
 * you.
 *
 * The recommender refuses to invent a price, a warranty, a response time or a
 * credential, and emits a visible placeholder instead. Every row here turns one
 * of those placeholders into publishable copy — which is the whole reason the
 * questions get asked.
 *
 * Key/value rather than columns because the question set will grow, and a
 * migration per question would guarantee it never does.
 */
export const clientFacts = sqliteTable('client_facts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientId: integer('client_id').notNull().references(() => clients.id),
  key: text('key').notNull(),
  value: text('value').notNull().default(''),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(now),
})
