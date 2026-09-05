import readline from 'node:readline/promises'
import { eq } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { resolveClient, clientLocations } from '../lib/resolve-client'
import { isPlaceBasedClient } from '../lib/client'
import { generatePrompts } from '../prompts/generate'
import { flag } from '../lib/args'
import { groupByMarket, marketLabelOf } from '../lib/markets'

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
    if (isPlaceBasedClient(client) && locations.length === 0) {
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
  console.log(`by intent: ${[...byIntent].map(([k, v]) => `${k} ${v}`).join(', ')}`)

  /**
   * Coverage per market, printed because it is the thing most worth checking:
   * a market with no core questions will not be measured at all, and that is
   * invisible in a flat list of thirty questions.
   */
  const markets = groupByMarket(locations)
  if (markets.length > 1) {
    const marketOfPlace = new Map(locations.map((l) => [l.id, marketLabelOf(l)]))
    console.log('by market:')
    for (const m of markets) {
      const mine = prompts.filter((p) => p.locationId != null && marketOfPlace.get(p.locationId) === m.label)
      console.log(
        `  ${m.label.padEnd(22)} ${String(mine.length).padStart(3)} questions, ` +
          `${mine.filter((p) => p.isCore).length} core`,
      )
    }
  }
  console.log('')

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

  /**
   * Same rule as add-client: a question written to a closed stdin must not end
   * the process quietly with a success code and nothing saved. `--yes` is the
   * scripted answer; without a terminal and without it, this stops and says so.
   */
  const interactive = process.stdin.isTTY === true
  const assumeYes = flag('yes')
  const confirm = async (question: string, whenYes: string): Promise<string> => {
    if (assumeYes) {
      console.log(`${question}${whenYes}`)
      return whenYes
    }
    if (!interactive) {
      rl.close()
      console.error(
        `\nstdin is not a terminal, so "${question.trim()}" cannot be asked. Nothing was saved.\n` +
          'Re-run with --yes to answer it, or --dry-run to see the set without saving.',
      )
      process.exitCode = 1
      return ''
    }
    return (await rl.question(question)).trim()
  }

  /**
   * A question is identified by its wording and its place, not by its row id.
   *
   * Regenerating a set is mostly idempotent — add a town and twenty-three of
   * twenty-five questions come back word for word — so matching on the wording
   * keeps every answer already collected against them attached. That is what
   * makes a second run a comparison rather than a fresh start.
   */
  const keyOf = (text: string, locationId: number | null) =>
    `${locationId ?? 0}|${text.trim().toLowerCase()}`

  const existingByKey = new Map(existing.map((p) => [keyOf(p.text, p.locationId), p]))
  const wantedKeys = new Set(prompts.map((p) => keyOf(p.text, p.locationId)))

  const unchanged = prompts.filter((p) => existingByKey.has(keyOf(p.text, p.locationId)))
  const added = prompts.filter((p) => !existingByKey.has(keyOf(p.text, p.locationId)))
  const dropped = existing.filter((p) => !wantedKeys.has(keyOf(p.text, p.locationId)))

  if (existing.length > 0) {
    console.log(`\n! ${client.name} already has ${existing.length} questions.`)
    console.log(`  ${unchanged.length} unchanged (their answers are kept), ${added.length} new.`)
    if (dropped.length > 0) {
      console.log(
        `  ${dropped.length} no longer generated — retired, not deleted, so their answers survive.`,
      )
    }
    const ok = await confirm('Update the set? [y/N] ', 'y')
    if (process.exitCode === 1) return
    if (!/^y(es)?$/i.test(ok)) {
      rl.close()
      console.log('cancelled — nothing changed')
      return
    }
  } else {
    const ok = await confirm('\nSave these questions? [Y/n] ', 'y')
    if (process.exitCode === 1) return
    if (/^n(o)?$/i.test(ok)) {
      rl.close()
      console.log('cancelled — nothing saved')
      return
    }
  }
  rl.close()

  /**
   * Retired rather than deleted.
   *
   * Every answer, screenshot and mention points at a prompt row, so deleting one
   * that has been measured either fails on the foreign key or throws away the
   * evidence the whole tool exists to collect. Deactivating it takes it out of
   * every later run while leaving the history readable.
   */
  for (const p of dropped) {
    db.update(schema.prompts)
      .set({ isActive: false })
      .where(eq(schema.prompts.id, p.id))
      .run()
  }

  // Re-activate anything that came back, and pick up a changed intent or core flag.
  for (const p of unchanged) {
    const row = existingByKey.get(keyOf(p.text, p.locationId))!
    db.update(schema.prompts)
      .set({ intent: p.intent, persona: p.persona, isCore: p.isCore, isActive: true })
      .where(eq(schema.prompts.id, row.id))
      .run()
  }

  if (added.length > 0) {
    db.insert(schema.prompts)
      .values(
        added.map((p) => ({
          clientId: client.id,
          locationId: p.locationId,
          text: p.text,
          intent: p.intent,
          persona: p.persona,
          isCore: p.isCore,
          isActive: true,
        })),
      )
      .run()
  }

  console.log(
    `\n${prompts.length} questions active — ${added.length} new, ${unchanged.length} kept` +
      (dropped.length > 0 ? `, ${dropped.length} retired` : ''),
  )
  console.log('\nnext:')
  console.log(`  npx tsx src/scripts/measure.ts --client=${client.id}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
