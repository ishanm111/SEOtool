import readline from 'node:readline/promises'
import { eq } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { detectClient, deriveWrongGeoTerms, type Detection } from '../onboard/detect'
import { stateFromAbbreviation, normaliseState, parseTypedPlace } from '../onboard/us-states'
import { flag } from '../lib/args'

/**
 * Adds a client from nothing but a URL.
 *
 *   npx tsx src/scripts/add-client.ts https://example.com
 *   npx tsx src/scripts/add-client.ts https://example.com --dry-run
 *
 * Detection is confident about some things (platform, page count) and uncertain
 * about others (which places a business genuinely serves). Everything is printed
 * before anything is written, and the uncertain parts are asked rather than
 * assumed — a wrong service area silently poisons every later measurement.
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

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  let servedStates: string[] = []
  let locations: { name: string; state: string }[] = []

  if (d.businessType === 'local_service') {
    const suggested = d.states[0]?.state ?? ''
    console.log('\nWhich states does this business ACTUALLY serve?')
    console.log('This decides which places count as wrong-geography, so it matters.')
    const answer = (await rl.question(`States, comma-separated${suggested ? ` [${suggested}]` : ''}: `)).trim()
    const raw = (answer || suggested).split(',').map((s) => s.trim()).filter(Boolean)
    servedStates = raw.map((s) => normaliseState(s)).filter((s): s is string => s !== null)

    if (servedStates.length === 0) {
      console.log('No valid states given — saving with no service area. You can add locations later.')
    } else {
      const inArea = d.places.filter((p) => servedStates.includes(p.state))
      if (inArea.length > 0) {
        console.log(`\n${inArea.length} places found in ${servedStates.join('/')}:`)
        console.log(`  ${inArea.map((p) => p.name).join(', ')}`)
        const keep = (
          await rl.question(
            'Use these as the service area? [Y/n] or type your own, comma-separated ' +
              '(add the state per town when they differ, e.g. "Houston TX, Virginia Beach VA"): ',
          )
        ).trim()
        if (keep === '' || /^y(es)?$/i.test(keep)) {
          locations = inArea.map((p) => ({ name: p.name, state: p.state }))
        } else if (!/^n(o)?$/i.test(keep)) {
          locations = keep
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((entry) => parseTypedPlace(entry, servedStates[0]))
        }
      } else {
        console.log(`\nNo places found in ${servedStates.join('/')} on the site itself.`)
        const typed = (
          await rl.question(
            'Type the towns served, comma-separated (add the state per town when they differ, e.g. "Houston TX, Virginia Beach VA"): ',
          )
        ).trim()
        if (typed) {
          locations = typed
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((entry) => parseTypedPlace(entry, servedStates[0]))
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

  const go = (await rl.question(`\nSave "${d.name}" as a client? [Y/n] `)).trim()
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
      businessType: d.businessType,
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
