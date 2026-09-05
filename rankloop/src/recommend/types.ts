import type { Client, ClientLocation } from '../lib/client'
import type { ClientFacts } from '../onboard/questionnaire'

/**
 * A single change to make. Never design — copy, metadata, structured data, or a
 * whole page that does not exist yet.
 */
export type Recommendation = {
  pageId: number | null
  kind: 'meta_title' | 'meta_description' | 'copy' | 'schema' | 'new_page'
  /** What this touches, in human terms: a URL, or a page that should exist. */
  target: string
  currentValue: string | null
  proposedValue: string
  reason: string
  /** 0-100, higher first. Ranked by measured impact, not by ease. */
  priority: number
}

export type PageRow = {
  id: number
  url: string
  slug: string
  title: string
  metaDescription: string
  text: string
  wordCount: number
  schemaTypes: string
  pageType: string
  wrongGeoHits: number
}

export type ParagraphRow = {
  id: number
  pageId: number
  sortOrder: number
  heading: string
  text: string
  wordCount: number
  statCount: number
  hasCitation: boolean
  superlativeCount: number
  readability: number
}

export type RecommendInput = {
  client: Client
  locations: ClientLocation[]
  pages: PageRow[]
  paragraphs: ParagraphRow[]
  /**
   * Answers to the intake questionnaire. Where one exists it is used verbatim;
   * where it does not, the placeholder stays. Nothing here is ever guessed at
   * from a similar-sounding answer.
   */
  facts?: ClientFacts
}

/**
 * Marks a value only the business can confirm.
 *
 * The single most important rule in this module: never invent a price, a
 * warranty, a credential, a review count or a response time. A wrong claim on a
 * client's live website is a legal problem, not a style one — so anything
 * unverifiable is emitted as a visible placeholder that blocks publication until
 * a human fills it in.
 */
export const FILL = (what: string) => `[[FILL: ${what}]]`

export const countPlaceholders = (s: string) => (s.match(/\[\[FILL:/g) ?? []).length

/** Words the research measures as neutral-to-negative for AI visibility. */
export const SUPERLATIVE_PATTERN =
  /\b(best|top[- ]rated|#1|number one|premier|leading|finest|unbeatable|unmatched|world[- ]class|greatest|most trusted|superior|ultimate|exceptional|outstanding|second to none|unrivalled|unrivaled|unparalleled)\b/gi
