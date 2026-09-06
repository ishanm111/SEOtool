import { eq } from 'drizzle-orm'
import { openDb, schema } from '../db/raw'
import { deriveAliases, hydrateClient } from '../lib/client'
import { mentionsClient } from '../analysis/parse'
import { arg, flag } from '../lib/args'

/**
 * Rebuilds the name variants for clients that already exist.
 *
 *   npx tsx src/scripts/backfill-aliases.ts --dry-run
 *   npx tsx src/scripts/backfill-aliases.ts
 *   npx tsx src/scripts/backfill-aliases.ts --client=3
 *
 * Aliases are generated when a client is added and then stored, so a client
 * added before the shortened forms existed keeps the list it was given — and
 * goes on scoring "El Barrilito Liquor" as a business nobody mentioned.
 *
 * Nothing is re-measured. Every answer an engine has ever given is already in
 * the database; only the question of which of them name the client changes, and
 * that is decided at read time. So this rewrites the alias lists and then says
 * how many stored answers change verdict, which is the number worth knowing
 * before deciding whether to re-run the analysis.
 *
 * Existing variants are kept. Some of them came from what the site called
 * itself rather than from the name, and detection is the only place those exist.
 */

async function main() {
  const db = openDb()
  const dryRun = flag('dry-run')
  const only = Number(arg('client')) || null

  const clients = db
    .select()
    .from(schema.clients)
    .all()
    .filter((c) => (only === null ? true : c.id === only))

  if (clients.length === 0) {
    console.log(only === null ? 'no clients' : `no client #${only}`)
    return
  }

  let changedClients = 0
  let changedAnswers = 0

  for (const row of clients) {
    const client = hydrateClient(row)
    const before = client.aliases
    const after = [...new Set([...deriveAliases(client.name), ...before])]
    const added = after.filter((a) => !before.includes(a))

    console.log(`\n#${client.id} ${client.name}`)
    if (added.length === 0) {
      console.log('  no new variants')
      continue
    }
    console.log(`  + ${added.join(', ')}`)

    /**
     * What the new variants change about answers already collected.
     *
     * Counted against the same test the dashboard uses, so the number printed
     * here is exactly the number of answers that will start being counted.
     */
    const prompts = db
      .select()
      .from(schema.prompts)
      .where(eq(schema.prompts.clientId, client.id))
      .all()
    const answers = prompts.flatMap((p) =>
      db.select().from(schema.runs).where(eq(schema.runs.promptId, p.id)).all(),
    )
    const newlyNamed = answers.filter(
      (a) =>
        !mentionsClient(a.answerText, { ...client, aliases: before }) &&
        mentionsClient(a.answerText, { ...client, aliases: after }),
    )

    console.log(
      `  ${newlyNamed.length} of ${answers.length} stored answers name them by one of the new variants`,
    )
    for (const a of newlyNamed.slice(0, 5)) {
      const hit = after.find((alias) => a.answerText.toLowerCase().includes(alias))
      console.log(`    answer #${a.id} (${a.engine}) — matched "${hit}"`)
    }

    changedClients += 1
    changedAnswers += newlyNamed.length

    if (!dryRun) {
      db.update(schema.clients)
        .set({ aliases: JSON.stringify(after) })
        .where(eq(schema.clients.id, client.id))
        .run()
    }
  }

  console.log(
    `\n${dryRun ? 'would update' : 'updated'} ${changedClients} client${changedClients === 1 ? '' : 's'}; ` +
      `${changedAnswers} stored answer${changedAnswers === 1 ? '' : 's'} change verdict.`,
  )

  if (!dryRun && changedAnswers > 0) {
    console.log(
      'The dashboard percentage is worked out at read time, so it is already right.\n' +
        'Findings and the client report are not — re-run `npm run analyze` to rebuild them.',
    )
  }
}

main()
