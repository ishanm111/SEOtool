import readline from 'node:readline/promises'
import { eq } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { resolveClient, clientLocations } from '../lib/resolve-client'
import { generatePrompts } from '../prompts/generate'
import { flag } from '../lib/args'

/**
 * Writes the question set for a client.
 *
 *   npx tsx src/scripts/generate-prompts.ts --client=2
 *   npx tsx src/scripts/generate-prompts.ts --client=2 --dry-run
 *
 * The set is always shown before it is saved. Generated questions are only as
 * good as the detected offerings, and a bad question quietly produces a bad
 * measurement — so a human reads them first. That gate is deliberate.
 */

async function main() {
  const db = openDb()
  const client = resolveClient(db)
  const locations = clientLocations(db, client.id)

  const prompts = generatePrompts(client, locations)

  if (prompts.length === 0) {
    console.log(`No prompts could be generated for ${client.name}.`)
    if (client.businessType === 'local_service' && locations.length === 0) {
      console.log('It is a local business with no locations recorded — add some and try again.')
    } else if (client.offerings.length === 0) {
      console.log('No offerings were detected on the site, so there is nothing to ask about.')
    }
    return
  }

  const byIntent = new Map<string, number>()
  for (const p of prompts) byIntent.set(p.intent, (byIntent.get(p.intent) ?? 0) + 1)

  console.log(`\n=== ${prompts.length} QUESTIONS FOR ${client.name} (${client.businessType}) ===`)
  console.log(`core subset: ${prompts.filter((p) => p.isCore).length}`)
  console.log(`by intent: ${[...byIntent].map(([k, v]) => `${k} ${v}`).join(', ')}\n`)

  let lastIntent = ''
  for (const p of prompts) {
    if (p.intent !== lastIntent) {
      console.log(`\n── ${p.intent.toUpperCase()} ──`)
      lastIntent = p.intent
    }
    const star = p.isCore ? '*' : ' '
    const older = p.persona === 'older' ? '  [older-customer]' : ''
    const where = p.locationName ? `[${p.locationName}] ` : ''
    console.log(`${star} ${where}${p.text}${older}`)
  }
  console.log('\n* = core subset, used for a quick daily sweep')

  if (flag('dry-run')) {
    console.log('\n(dry run — nothing saved)')
    return
  }

  const existing = db.select().from(schema.prompts).where(eq(schema.prompts.clientId, client.id)).all()
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  if (existing.length > 0) {
    console.log(`\n! ${client.name} already has ${existing.length} questions.`)
    console.log('  Replacing them orphans any measurements already taken against them.')
    const ok = (await rl.question('Replace them? [y/N] ')).trim()
    if (!/^y(es)?$/i.test(ok)) {
      rl.close()
      console.log('cancelled — nothing changed')
      return
    }
  } else {
    const ok = (await rl.question('\nSave these questions? [Y/n] ')).trim()
    if (/^n(o)?$/i.test(ok)) {
      rl.close()
      console.log('cancelled — nothing saved')
      return
    }
  }
  rl.close()

  const locationByName = new Map(locations.map((l) => [l.name, l.id]))

  db.delete(schema.prompts).where(eq(schema.prompts.clientId, client.id)).run()
  db.insert(schema.prompts)
    .values(
      prompts.map((p) => ({
        clientId: client.id,
        locationId: p.locationName ? (locationByName.get(p.locationName) ?? null) : null,
        text: p.text,
        intent: p.intent,
        persona: p.persona,
        isCore: p.isCore,
        isActive: true,
      })),
    )
    .run()

  console.log(`\nsaved ${prompts.length} questions`)
  console.log('\nnext:')
  console.log(`  npx tsx src/scripts/measure.ts --client=${client.id}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
