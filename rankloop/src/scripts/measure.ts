import { eq } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { askChatEngine, openBrowser, pacingDelay, SHOTS_DIR } from '../engines/browser'
import { askGoogleViaBrowser } from '../engines/google-browser'
import { CHAT_ENGINES } from '../engines/chat-engines'
import { askGoogle } from '../engines/dataforseo'
import { resolveClient, clientLocations } from '../lib/resolve-client'
import { loadEnv } from '../lib/env'
import { arg, flag } from '../lib/args'

loadEnv()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}


/** Three consecutive failures means the engine is broken or blocking us. Stop wasting time on it. */
const FAILURE_LIMIT = 3

async function main() {
  const db = openDb()
  const client = resolveClient(db)
  console.log(`measuring ${client.name} (${client.domain})\n`)

  /**
   * `--engines=none` runs Google alone, which is how a Google-only pass is added
   * to a client that already has fresh chat-engine answers — re-asking all three
   * would waste half an hour and risk the rate limits for nothing.
   */
  const enginesArg = arg('engines')
  const wanted = enginesArg?.split(',').map((s) => s.trim())
  const engines =
    enginesArg === 'none' ? [] : CHAT_ENGINES.filter((e) => !wanted || wanted.includes(e.name))
  if (engines.length === 0 && enginesArg !== 'none') {
    throw new Error(`no engines matched --engines=${enginesArg}`)
  }

  let prompts = db
    .select()
    .from(schema.prompts)
    .where(eq(schema.prompts.clientId, client.id))
    .all()
    .filter((p) => p.isActive)
  const only = arg('prompt')?.split(',').map(Number)
  if (only) prompts = prompts.filter((p) => only.includes(p.id))
  else if (!flag('all')) prompts = prompts.filter((p) => p.isCore)
  const limit = Number(arg('limit') ?? 0)
  if (limit > 0) prompts = prompts.slice(0, limit)

  const locations = clientLocations(db, client.id)
  const locationById = new Map(locations.map((l) => [l.id, l]))
  /** Broader anchor to retry against when a small locality is unrecognised. */
  const metroAnchor = new Map<string, string>()
  for (const l of locations) {
    if (l.metro && !metroAnchor.has(l.metro)) metroAnchor.set(l.metro, l.dataforseoLocation)
  }

  /**
   * Google can be read two ways:
   *   --google=api      DataForSEO — sees results from the client's own city
   *   --google=browser  a real browser — free, but sees them from THIS machine
   *
   * The browser route is honest for one client whose queries name their city,
   * and wrong for several clients in places the operator is not.
   */
  const googleMode = arg('google') ?? (process.env.DATAFORSEO_LOGIN ? 'api' : 'off')
  const useGoogleApi = !flag('skip-google') && googleMode === 'api' && !!process.env.DATAFORSEO_LOGIN
  const useGoogleBrowser = !flag('skip-google') && googleMode === 'browser'
  const useGoogle = useGoogleApi || useGoogleBrowser

  if (useGoogleBrowser) {
    console.log('Google via browser — results reflect THIS machine\'s location, not the client\'s.\n')
  } else if (!useGoogle) {
    console.log('! Google is OFF. Use --google=browser (free) or set DATAFORSEO_LOGIN.\n')
  }

  const totalAsks = prompts.length * (engines.length + (useGoogle ? 1 : 0))
  const estMin = Math.round((prompts.length * engines.length * 67) / 60)
  console.log(`${prompts.length} prompts x ${engines.length + (useGoogle ? 1 : 0)} engines = ${totalAsks} asks`)
  console.log(`rough estimate: ${estMin} minutes at human pacing\n`)

  const context = await openBrowser(flag('headless'))
  const consecutiveFailures = new Map<string, number>()
  const tally = new Map<string, { ok: number; failed: number; mentioned: number }>()
  for (const e of engines) tally.set(e.name, { ok: 0, failed: 0, mentioned: 0 })
  if (useGoogle) tally.set('google_aio', { ok: 0, failed: 0, mentioned: 0 })

  const saveCitations = (runId: number, cites: { url: string; position: number }[]) => {
    if (cites.length === 0) return
    db.insert(schema.citations)
      .values(
        cites.map((c) => {
          const domain = domainOf(c.url)
          return {
            runId,
            url: c.url,
            domain,
            isClientDomain: domain.includes(client.domain),
            position: c.position,
          }
        }),
      )
      .run()
  }

  // A bot check means every later Google request is wasted, so stop asking.
  let googleBlocked = false

  let n = 0
  try {
    for (const prompt of prompts) {
      for (const engine of engines) {
        if ((consecutiveFailures.get(engine.name) ?? 0) >= FAILURE_LIMIT) continue

        n++
        const label = `${n}/${totalAsks}`
        process.stdout.write(`[${label}] ${engine.name.padEnd(11)} ${prompt.text.slice(0, 60)}... `)

        const shotName = `p${prompt.id}_${engine.name}`
        const result = await askChatEngine(context, engine, prompt.text, shotName)

        const inserted = db
          .insert(schema.runs)
          .values({
            promptId: prompt.id,
            engine: engine.name,
            answerText: result.answerText,
            screenshotPath: result.screenshotPath ?? null,
            ok: result.ok,
            error: result.error ?? null,
          })
          .returning({ id: schema.runs.id })
          .all()
        const runId = inserted[0].id

        saveCitations(runId, result.citations)

        const stats = tally.get(engine.name)!
        if (result.ok) {
          consecutiveFailures.set(engine.name, 0)
          stats.ok++
          const named = client.aliases.some((a) => result.answerText.toLowerCase().includes(a))
          if (named) stats.mentioned++
          console.log(`ok (${result.answerText.length} chars, ${result.citations.length} links)${named ? '  <-- CLIENT NAMED' : ''}`)
        } else {
          const fails = (consecutiveFailures.get(engine.name) ?? 0) + 1
          consecutiveFailures.set(engine.name, fails)
          stats.failed++
          console.log(`FAILED — ${result.error}`)
          if (fails >= FAILURE_LIMIT) {
            console.log(`  ! skipping ${engine.name} for the rest of this run (${FAILURE_LIMIT} failures in a row)`)
          }
        }

        if (n < totalAsks) await sleep(pacingDelay())
      }

      if (useGoogle && !googleBlocked) {
        n++
        const loc = prompt.locationId ? locationById.get(prompt.locationId) : undefined
        // An online store has no locations, so Google is asked without one.
        const location = loc?.dataforseoLocation ?? locations[0]?.dataforseoLocation ?? ''
        process.stdout.write(`[${n}/${totalAsks}] google_aio  ${prompt.text.slice(0, 60)}... `)

        const g = useGoogleBrowser
          ? await (async () => {
              const b = await askGoogleViaBrowser(context, prompt.text, `p${prompt.id}_google`, SHOTS_DIR)
              if (b.blocked) googleBlocked = true
              return {
                aiOverviewText: b.aiOverviewText,
                localPack: b.localPack,
                organic: b.organic,
                citations: b.citations,
                screenshotPath: b.screenshotPath,
                ok: b.ok,
                error: b.error,
              }
            })()
          : {
              ...(await askGoogle(prompt.text, location, loc ? metroAnchor.get(loc.metro) : undefined)),
              screenshotPath: undefined as string | undefined,
            }

        const inserted = db
          .insert(schema.runs)
          .values({
            promptId: prompt.id,
            engine: 'google_aio',
            answerText: g.aiOverviewText,
            screenshotPath: g.screenshotPath ?? null,
            rawPayload: JSON.stringify({ localPack: g.localPack, organic: g.organic.slice(0, 10) }),
            ok: g.ok,
            error: g.error ?? null,
          })
          .returning({ id: schema.runs.id })
          .all()
        saveCitations(inserted[0].id, g.citations)

        const stats = tally.get('google_aio')!
        if (g.ok) {
          stats.ok++
          const named =
            client.aliases.some((a: string) => g.aiOverviewText.toLowerCase().includes(a)) ||
            g.localPack.some((l) => client.aliases.some((a: string) => l.title.toLowerCase().includes(a)))
          if (named) stats.mentioned++
          const bar = g.localPack
            .map((l) => `${l.title} ${l.rating ?? '?'}★(${l.ratingCount ?? '?'})`)
            .join(', ')
          console.log(
            `ok — AIO ${g.aiOverviewText ? `${g.aiOverviewText.length} chars` : 'none'}, ` +
              `${g.localPack.length} in map pack${named ? '  <-- CLIENT NAMED' : ''}`,
          )
          if (bar) console.log(`             map pack: ${bar}`)
        } else {
          stats.failed++
          console.log(`FAILED — ${g.error}`)
          if (googleBlocked) {
            console.log('  ! Google is blocking this machine — skipping it for the rest of the run')
          }
        }

        // Google tolerates far less than the chat assistants do.
        if (useGoogleBrowser && n < totalAsks) await sleep(pacingDelay(20, 40))
      }
    }
  } finally {
    await context.close().catch(() => {})
  }

  console.log('\n=== RESULT ===')
  for (const [name, s] of tally) {
    console.log(`${name.padEnd(11)} ${s.ok} ok, ${s.failed} failed, client named in ${s.mentioned}/${s.ok}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
