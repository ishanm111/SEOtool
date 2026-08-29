import { eq } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { resolveClient, clientLocations } from '../lib/resolve-client'
import { groupByMarket } from '../lib/markets'
import { arg } from '../lib/args'

/**
 * Groups a client's places into markets by hand.
 *
 * Markets default to the state, which is right for a business with branches in
 * two states and wrong for one with branches at opposite ends of the same state:
 * two metros a hundred miles apart are separate contests with separate rivals,
 * and no rule derived from a place name can tell them apart. So the operator
 * says which is which, once, and every later measurement and report splits on it.
 *
 *   npm run market -- --client=1
 *   npm run market -- --client=1 --location=6,7,8 --market="Northern Virginia"
 */
function main() {
  const db = openDb()
  const client = resolveClient(db)
  const locations = clientLocations(db, client.id)

  if (locations.length === 0) {
    console.log(`${client.name} has no locations — nothing to group.`)
    return
  }

  const label = arg('market')
  const which = arg('location')

  if (!label || !which) {
    console.log(`${client.name} — ${locations.length} places in ${groupByMarket(locations).length} markets\n`)
    for (const m of groupByMarket(locations)) {
      console.log(`${m.label}`)
      for (const l of m.locations) {
        console.log(`  #${String(l.id).padEnd(4)} ${l.name}${l.region ? `, ${l.region}` : ''}`)
      }
    }
    console.log('\nto regroup:')
    console.log(`  npm run market -- --client=${client.id} --location=<ids or names> --market="<name>"`)
    return
  }

  const wanted = which.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const matched = locations.filter(
    (l) => wanted.includes(String(l.id)) || wanted.includes(l.name.toLowerCase()),
  )

  const unmatched = wanted.filter(
    (w) => !locations.some((l) => String(l.id) === w || l.name.toLowerCase() === w),
  )
  if (unmatched.length > 0) {
    throw new Error(
      `no location matches ${unmatched.join(', ')}. Known places:\n` +
        locations.map((l) => `  #${l.id}  ${l.name}`).join('\n'),
    )
  }

  for (const l of matched) {
    db.update(schema.locations).set({ metro: label }).where(eq(schema.locations.id, l.id)).run()
  }

  console.log(`${matched.length} places moved into "${label}": ${matched.map((l) => l.name).join(', ')}\n`)

  const after = groupByMarket(clientLocations(db, client.id))
  console.log(`${client.name} now has ${after.length} market${after.length === 1 ? '' : 's'}:`)
  for (const m of after) console.log(`  ${m.label.padEnd(22)} ${m.locations.map((l) => l.name).join(', ')}`)
  console.log('\nregenerate the question set so each market gets its own:')
  console.log(`  npm run prompts -- --client=${client.id}`)
}

main()
