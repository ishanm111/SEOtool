import { openDb } from '../db/raw'
import { resolveClient } from '../lib/resolve-client'
import { loadFacts } from '../lib/facts'
import { formDescriptionFor, formItemsFor, formTitleFor } from '../onboard/questionnaire-form'
import { loadEnv } from '../lib/env'

/**
 * Prints the form that would be created, without creating one.
 *
 * Useful on its own — an operator can read the questions before sending them to
 * a client — and it is the only way to check the mapping without spending a
 * real Google Form on each attempt.
 *
 *   npm run forms-preview -- --client=7
 */
function main() {
  loadEnv()
  const db = openDb()
  const client = resolveClient(db)
  const facts = loadFacts(db, client.id)
  const items = formItemsFor(client, facts)

  console.log(`TITLE: ${formTitleFor(client)}`)
  console.log(`\nDESCRIPTION:\n${formDescriptionFor(client)}`)
  console.log(`\n--- ${items.filter((i) => i.kind === 'question').length} questions ---\n`)

  for (const item of items) {
    if (item.kind === 'header') {
      console.log(`\n## ${item.title}`)
      if (item.description) console.log(`   ${item.description.slice(0, 100)}…`)
      continue
    }
    const shape =
      item.type === 'choice' ? `choice: ${(item.options ?? []).join(' | ')}` : item.type
    console.log(`  • ${item.title}  [${shape}]`)
  }
  console.log('')
}

main()
