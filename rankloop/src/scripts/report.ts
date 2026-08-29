import fs from 'node:fs'
import path from 'node:path'
import { eq, inArray } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { resolveClient, clientLocations } from '../lib/resolve-client'
import { renderReport, type ReportData } from '../report/template'
import { isAnswer, mentionsClient } from '../analysis/parse'
import { RATING_THRESHOLDS } from '../config'
import { arg } from '../lib/args'

const OUT_DIR = path.resolve('reports')
/** Keeps the file emailable — screenshots are the bulk of the size. */
const MAX_EMBEDDED_SCREENSHOTS = 3


function embedImage(relPath: string | null): string | undefined {
  if (!relPath) return undefined
  const abs = path.resolve(relPath)
  if (!fs.existsSync(abs)) return undefined
  const bytes = fs.readFileSync(abs)
  if (bytes.length > 2_000_000) return undefined
  return `data:image/png;base64,${bytes.toString('base64')}`
}

function main() {
  const db = openDb()
  const client = resolveClient(db)
  const locations = clientLocations(db, client.id)

  const pages = db.select().from(schema.pages).where(eq(schema.pages.clientId, client.id)).all()
  const pageIds = pages.map((p) => p.id)
  const paragraphs =
    pageIds.length > 0
      ? db.select().from(schema.paragraphs).where(inArray(schema.paragraphs.pageId, pageIds)).all()
      : []

  const prompts = db.select().from(schema.prompts).where(eq(schema.prompts.clientId, client.id)).all()
  const promptById = new Map(prompts.map((p) => [p.id, p]))
  const promptIds = prompts.map((p) => p.id)
  const runs =
    promptIds.length > 0
      ? db.select().from(schema.runs).where(inArray(schema.runs.promptId, promptIds)).all()
      : []
  const runIds = runs.map((r) => r.id)

  const mentions =
    runIds.length > 0
      ? db.select().from(schema.mentions).where(inArray(schema.mentions.runId, runIds)).all()
      : []
  const citations =
    runIds.length > 0
      ? db.select().from(schema.citations).where(inArray(schema.citations.runId, runIds)).all()
      : []

  const findings = db.select().from(schema.findings).where(eq(schema.findings.clientId, client.id)).all()
  // New pages are recommendations now; the old generated_pages table is dead.
  const generated = db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.clientId, client.id))
    .all()
    .filter((r) => r.kind === 'new_page')

  const okRuns = runs.filter(isAnswer)
  const named = okRuns.filter((r) => mentionsClient(r.answerText, client)).length

  const byEngine = new Map<string, { engine: string; ok: number; named: number }>()
  for (const r of okRuns) {
    const e = byEngine.get(r.engine) ?? { engine: r.engine, ok: 0, named: 0 }
    e.ok++
    if (mentionsClient(r.answerText, client)) e.named++
    byEngine.set(r.engine, e)
  }

  const competitorCounts = new Map<string, number>()
  for (const m of mentions) {
    if (!m.isClient) competitorCounts.set(m.businessName, (competitorCounts.get(m.businessName) ?? 0) + 1)
  }

  const domainCounts = new Map<string, number>()
  for (const c of citations) domainCounts.set(c.domain, (domainCounts.get(c.domain) ?? 0) + 1)

  const rivals = db
    .select()
    .from(schema.competitors)
    .where(eq(schema.competitors.clientId, client.id))
    .all()
    .filter((c) => c.ok)
  const locals = rivals.filter((c) => !c.isNational && c.pageCount > 0)
  const avg = (f: (c: (typeof locals)[number]) => number) =>
    locals.length ? Math.round((locals.reduce((a, c) => a + f(c), 0) / locals.length) * 10) / 10 : 0

  const substantial = paragraphs.filter((p) => p.wordCount >= 40)
  const myWords = substantial.reduce((a, p) => a + p.wordCount, 0)
  const mySchema = new Set<string>()
  for (const p of pages) (JSON.parse(p.schemaTypes || '[]') as string[]).forEach((t) => mySchema.add(t))

  const gap: ReportData['gap'] = [
    { label: 'Total pages', client: pages.length, rivals: avg((c) => c.pageCount) },
    {
      label: 'Pages targeting a place you serve',
      note: 'the strongest signal in this data',
      client: 0,
      rivals: avg((c) => c.cityPageCount),
    },
    {
      label: 'FAQ sections',
      note: 'the format AI assistants quote most often',
      client: 0,
      rivals: avg((c) => c.faqBlockCount),
    },
    {
      label: 'Facts and figures per 1,000 words',
      note: 'concrete numbers are the single biggest measured lever',
      client: myWords ? Math.round((substantial.reduce((a, p) => a + p.statCount, 0) / myWords) * 1000 * 10) / 10 : 0,
      rivals: avg((c) => c.statsPerThousand),
    },
    {
      label: 'Business details in the page code',
      note: 'how search engines confirm what this business is',
      client: [...mySchema].some((t) => /LocalBusiness|Service$|Product/i.test(t)) ? 'Yes' : 'No',
      rivals: `${locals.filter((c) => c.hasLocalBusiness).length} of ${locals.length} have it`,
    },
    {
      label: 'Superlatives ("best", "#1")',
      note: 'research measures these as neutral to negative — fewer is better',
      client: paragraphs.reduce((a, p) => a + p.superlativeCount, 0),
      rivals: avg((c) => c.superlativeCount),
    },
  ]

  const evidence: ReportData['evidence'] = okRuns
    .filter((r) => promptById.get(r.promptId)?.intent === 'comparison')
    .slice(0, MAX_EMBEDDED_SCREENSHOTS)
    .map((r) => ({
      engine: r.engine,
      question: promptById.get(r.promptId)?.text ?? '',
      excerpt: r.answerText.slice(0, 700),
      image: embedImage(r.screenshotPath),
    }))

  const marketFallback = locations.length
    ? [...new Set(locations.map((l) => l.metro || l.name))].join(' and ')
    : 'online'

  const data: ReportData = {
    clientName: client.name,
    clientDomain: client.domain,
    businessType: client.businessType,
    hasGoogleProfile: client.gbpRating !== null || client.gbpUrl !== null,
    market: arg('market') ?? marketFallback,
    generatedOn:
      arg('date') ?? new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }),
    named,
    totalAnswers: okRuns.length,
    engines: [...byEngine.values()],
    competitors: [...competitorCounts].sort((a, b) => b[1] - a[1]),
    citedDomains: [...domainCounts].sort((a, b) => b[1] - a[1]).slice(0, 10),
    cityLeaders: locals
      .filter((c) => c.cityPageCount > 0)
      .sort((a, b) => b.cityPageCount - a.cityPageCount)
      .map((c) => ({ domain: c.domain, cityPageCount: c.cityPageCount, pageCount: c.pageCount })),
    gap,
    rivalCount: locals.length,
    criticalFindings: findings
      .filter((f) => f.severity === 'critical')
      .map((f) => ({ category: f.category, issue: f.issue, proposedText: f.proposedText })),
    highFindings: findings
      .filter((f) => f.severity === 'high')
      .map((f) => ({ category: f.category, issue: f.issue, proposedText: f.proposedText })),
    pageCount: pages.length,
    paragraphCount: paragraphs.length,
    wrongGeoPages: pages.filter((p) => p.wrongGeoHits > 0).length,
    wrongGeoHits: pages.reduce((a, p) => a + p.wrongGeoHits, 0),
    gbp: {
      rating: client.gbpRating,
      reviewCount: client.gbpReviewCount,
      hasWebsite: client.gbpHasWebsite,
    },
    thresholds: RATING_THRESHOLDS,
    evidence,
    generatedPageCount: generated.length,
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const slug = client.domain.replace(/\W+/g, '-')
  const file = path.join(OUT_DIR, `${slug}-ai-visibility-audit.html`)
  fs.writeFileSync(file, renderReport(data), 'utf8')

  const kb = Math.round(fs.statSync(file).size / 1024)
  console.log(`report written: ${file}  (${kb} KB)`)
  console.log(`  client: ${client.name} (${client.businessType})`)
  console.log(`  headline: named in ${data.named} of ${data.totalAnswers} AI answers`)
  console.log(`  ${data.criticalFindings.length} critical findings, ${data.highFindings.length} high`)
  console.log(`  ${data.evidence.length} answers embedded as evidence`)
}

main()
