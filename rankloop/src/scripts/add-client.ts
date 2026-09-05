import readline from 'node:readline/promises'
import { eq } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { detectClient, deriveWrongGeoTerms, type Detection } from '../onboard/detect'
import { stateFromAbbreviation, normaliseState, parseTypedPlace } from '../onboard/us-states'
import { expandZipEntries } from '../onboard/zip'
import { arg, flag } from '../lib/args'
import { BUSINESS_TYPES, isPlaceBased, type BusinessType } from '../config'

/**
 * Adds a client from nothing but a URL.
 *
 *   npx tsx src/scripts/add-client.ts https://example.com
 *   npx tsx src/scripts/add-client.ts https://example.com --dry-run
 *   npx tsx src/scripts/add-client.ts https://example.com --type=local_retail --states=TX --towns="Pasadena TX, 77002" --yes
 *
 * Detection is confident about some things (platform, page count) and uncertain
 * about others (which places a business genuinely serves). Everything is printed
 * before anything is written, and the uncertain parts are asked rather than
 * assumed — a wrong service area silently poisons every later measurement.
 *
 * The answers can also arrive as flags, which is the only way to run this from a
 * script or a test. Without a terminal and without the flags it stops and says
 * so: a prompt written to a closed stdin used to end the process quietly with a
 * success code and nothing saved, which reads exactly like a run that worked.
 */


function report(d: Detection) {
  const line = (label: string, value: string) => console.log(`  ${label.padEnd(16)} ${value}`)

  console.log(`\n=== DETECTED: ${d.name} ===`)
  line('domain', d.domain)
  line('platform', d.platform + (d.apiBase ? `  (api: ${d.apiBase})` : ''))
  line('business type', d.businessTypeConfidence)
  line('pages found', String(d.pageCount))
  line('phones', d.phones.length ? d.phones.join(', ') : '(none)')
  line('schema', d.schemaTypes.length ? d.schemaTypes.join(', ') : '(none)')
  line('aliases', d.aliases.join(' · '))

  if (d.nameCandidates.length > 1) {
    console.log('\n  name candidates (they disagree — pick the right one):')
    d.nameCandidates.forEach((c, i) => console.log(`    ${i + 1}. ${c.value.padEnd(40)} (${c.source})`))
  }

  if (d.states.length > 0) {
    console.log('\n  states mentioned:')
    for (const s of d.states) {
      console.log(`    ${s.state}  ${String(s.mentions).padStart(4)} mentions  (${stateFromAbbreviation(s.state) ?? s.state})`)
    }
  }

  if (d.places.length > 0) {
    console.log('\n  places mentioned:')
    for (const p of d.places.slice(0, 20)) {
      console.log(`    ${p.name}, ${p.state}`.padEnd(36) + `${p.mentions} mentions`)
    }
    if (d.places.length > 20) console.log(`    … and ${d.places.length - 20} more`)
  }

  if (d.offerings.length > 0) {
    console.log(`\n  offerings (${d.offerings.length}):`)
    console.log(`    ${d.offerings.slice(0, 18).join(', ')}${d.offerings.length > 18 ? ' …' : ''}`)
  }

  if (d.warnings.length > 0) {
    console.log('\n  ! needs attention:')
    for (const w of d.warnings) console.log(`    - ${w}`)
  }
}

async function main() {
  const url = process.argv[2]
  if (!url || url.startsWith('--')) {
    throw new Error('usage: npx tsx src/scripts/add-client.ts <url> [--dry-run]')
  }

  console.log(`inspecting ${url} …`)
  const d = await detectClient(url)
  report(d)

  if (flag('dry-run')) {
    console.log('\n(dry run — nothing saved)')
    return
  }

  const db = openDb()
  const existing = db.select().from(schema.clients).where(eq(schema.clients.domain, d.domain)).all()[0]
  if (existing) {
    console.log(`\n${d.domain} is already client #${existing.id}. Delete it first to re-add.`)
    return
  }

  /**
   * Answers supplied up front. `--yes` alone means "take the suggestion for
   * everything", which is exactly what a human pressing return three times does.
   */
  const statesFlag = arg('states')
  const townsFlag = arg('towns')
  /**
   * What kind of business this is, when the operator already knows. Detection
   * guesses well enough for a plumber and an online store, but a shop looks
   * like both, and the kind decides which questions are put to the engines.
   */
  const typeFlag = arg('type')
  const businessType: BusinessType = BUSINESS_TYPES.includes(typeFlag as BusinessType)
    ? (typeFlag as BusinessType)
    : d.businessType
  if (typeFlag !== undefined && businessType !== typeFlag) {
    console.error(`\n--type must be one of: ${BUSINESS_TYPES.join(', ')}`)
    process.exitCode = 1
    return
  }
  if (businessType !== d.businessType) {
    console.log(`\nbusiness type: ${businessType} (you said so; the site read as ${d.businessType})`)
  }
  const assumeYes = flag('yes')
  const interactive = process.stdin.isTTY === true

  if (!interactive && !assumeYes && statesFlag === undefined && townsFlag === undefined) {
    console.error(
      '\nstdin is not a terminal and no answers were given, so the questions below cannot be asked.\n' +
        'Re-run with the answers as flags, for example:\n' +
        `  npx tsx src/scripts/add-client.ts ${url} --states=TX --towns="Pasadena TX, Houston TX" --yes\n` +
        'or add --yes to accept the detected service area unchanged.',
    )
    process.exitCode = 1
    return
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  /**
   * One question, answered by a flag, by the operator, or by the default.
   *
   * Every path returns a string, so a closed stdin can no longer leave a pending
   * promise that never settles — which is what ended the process with nothing
   * written and nothing said.
   */
  const ask = async (question: string, preset: string | undefined): Promise<string> => {
    if (preset !== undefined) {
      console.log(`${question}${preset}`)
      return preset
    }
    if (!interactive) {
      console.log(`${question}(assumed)`)
      return ''
    }
    return (await rl.question(question)).trim()
  }

  let servedStates: string[] = []
  let locations: { name: string; state: string }[] = []

  /**
   * A typed service area, which may be given as towns, as ZIP codes, or both.
   *
   * ZIPs are resolved to their towns here rather than stored: the questions put
   * to the engines are asked by place name, and "best plumber in 77002" is not
   * a question anybody asks. An unresolvable ZIP is dropped and named, never
   * saved as if it were a town.
   */
  const typedPlaces = async (raw: string) => {
    const entries = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const { entries: expanded, resolved, unresolved } = await expandZipEntries(entries)
    for (const p of resolved) console.log(`  ${p.zip} → ${p.name} ${p.state}`)
    if (unresolved.length > 0) {
      console.log(`  no town found for ${unresolved.join(', ')} — skipped, type the town names instead`)
    }
    return expanded.map((entry) => parseTypedPlace(entry, servedStates[0]))
  }

  if (isPlaceBased(businessType)) {
    const suggested = d.states[0]?.state ?? ''
    console.log('\nWhich states does this business ACTUALLY serve?')
    console.log('This decides which places count as wrong-geography, so it matters.')
    const answer = await ask(`States, comma-separated${suggested ? ` [${suggested}]` : ''}: `, statesFlag)
    const raw = (answer || suggested).split(',').map((s) => s.trim()).filter(Boolean)
    servedStates = raw.map((s) => normaliseState(s)).filter((s): s is string => s !== null)

    if (servedStates.length === 0) {
      console.log('No valid states given — saving with no service area. You can add locations later.')
    } else {
      const inArea = d.places.filter((p) => servedStates.includes(p.state))
      if (inArea.length > 0) {
        console.log(`\n${inArea.length} places found in ${servedStates.join('/')}:`)
        console.log(`  ${inArea.map((p) => p.name).join(', ')}`)
        const keep = await ask(
          'Use these as the service area? [Y/n] or type your own, comma-separated ' +
            '(towns or ZIP codes; add the state per town when they differ, e.g. "Houston TX, Virginia Beach VA, 77002"): ',
          townsFlag,
        )
        if (keep === '' || /^y(es)?$/i.test(keep)) {
          locations = inArea.map((p) => ({ name: p.name, state: p.state }))
        } else if (!/^n(o)?$/i.test(keep)) {
          locations = await typedPlaces(keep)
        }
      } else {
        console.log(`\nNo places found in ${servedStates.join('/')} on the site itself.`)
        const typed = await ask(
          'Type the towns served, comma-separated — towns or ZIP codes (add the state per town when they differ, e.g. "Houston TX, Virginia Beach VA, 77002"): ',
          townsFlag,
        )
        if (typed) {
          locations = await typedPlaces(typed)
        }
      }
    }
  }

  const wrongGeoTerms = servedStates.length > 0 ? deriveWrongGeoTerms(d, servedStates) : []
  if (wrongGeoTerms.length > 0) {
    console.log(`\nWrong-geography terms derived (${wrongGeoTerms.length}):`)
    console.log(`  ${wrongGeoTerms.slice(0, 25).join(', ')}${wrongGeoTerms.length > 25 ? ' …' : ''}`)
    console.log('  Pages mentioning these will be flagged as targeting the wrong area.')
  }

  const go = await ask(`\nSave "${d.name}" as a client? [Y/n] `, assumeYes ? 'y' : undefined)
  rl.close()
  if (/^n(o)?$/i.test(go)) {
    console.log('cancelled — nothing saved')
    return
  }

  const clientId = db
    .insert(schema.clients)
    .values({
      name: d.name,
      domain: d.domain,
      homepageUrl: d.homepageUrl,
      businessType,
      platform: d.platform,
      apiBase: d.apiBase,
      aliases: JSON.stringify(d.aliases),
      phones: JSON.stringify(d.phones),
      primaryPhone: d.primaryPhone,
      offerings: JSON.stringify(d.offerings),
      wrongGeoTerms: JSON.stringify(wrongGeoTerms),
      isActive: true,
    })
    .returning({ id: schema.clients.id })
    .all()[0].id

  if (locations.length > 0) {
    db.insert(schema.locations)
      .values(
        locations.map((l) => {
          const full = stateFromAbbreviation(l.state) ?? l.state
          return {
            clientId,
            name: l.name,
            region: full,
            metro: full,
            dataforseoLocation: `${l.name},${full},United States`,
            isActive: true,
          }
        }),
      )
      .run()
  }

  console.log(`\nsaved as client #${clientId}`)
  console.log(`  ${locations.length} locations`)
  console.log(`  ${wrongGeoTerms.length} wrong-geography terms`)
  console.log('\nnext:')
  console.log(`  npx tsx src/scripts/ingest.ts --client=${clientId}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
