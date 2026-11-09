import { clientQuestionGroups } from '../onboard/client-questionnaire'
import { BUSINESS_TYPE_LABELS, type BusinessType } from '../config'
import { arg } from '../lib/args'

/**
 * The questionnaire as plain text, ready to be typed into a form by hand.
 *
 *   npm run questionnaire-text -- --type=local_service
 *
 * There is a button that builds a Google Form through the API, and it needs a
 * Cloud project, two enabled APIs and an OAuth client before it will do
 * anything. That is a lot of setup to avoid twenty minutes of typing, and the
 * question set barely differs between two businesses of the same kind — so one
 * form per business type, made once by hand, covers every client there will
 * ever be.
 *
 * Printed from the same definition the console and the hosted page read, so a
 * form built from this output asks exactly what the tool expects back.
 */

const TYPE_IN_FORMS: Record<string, string> = {
  text: 'Short answer',
  textarea: 'Paragraph',
  select: 'Multiple choice',
}

function main() {
  const type = (arg('type') ?? 'local_service') as BusinessType
  const label = BUSINESS_TYPE_LABELS[type]
  if (!label) {
    console.error(`Unknown --type. One of: ${Object.keys(BUSINESS_TYPE_LABELS).join(', ')}`)
    process.exit(1)
  }

  // No facts: every question, because a form made by hand is reused across
  // clients and cannot know which of them has already answered what.
  const groups = clientQuestionGroups(type, {})
  const total = groups.reduce((n, g) => n + g.questions.length, 0)

  const out: string[] = []
  out.push(`FORM TITLE`)
  out.push(`  A few questions about your business`)
  out.push('')
  out.push(`FORM DESCRIPTION`)
  out.push(
    `  These are the things about your business that cannot be read off your website,`,
  )
  out.push(
    `  and every one of them is something an AI assistant looks for when it decides`,
  )
  out.push(`  which business to recommend.`)
  out.push('')
  out.push(`  Every question is optional — answer what you can and skip the rest.`)
  out.push(`  Nothing you write here goes on your website until you have been shown it first.`)
  out.push('')
  out.push(`${total} questions, for: ${label.label}`)
  out.push('')

  let n = 0
  for (const group of groups) {
    out.push('')
    out.push(`${'═'.repeat(70)}`)
    out.push(`SECTION: ${group.title}`)
    out.push(`${'═'.repeat(70)}`)
    out.push(`  ${group.intro}`)
    out.push('')

    for (const q of group.questions) {
      n += 1
      out.push(`${n}. ${q.label}`)
      out.push(`   [${TYPE_IN_FORMS[q.kind]}]`)
      for (const line of q.help.split('\n')) {
        out.push(line.trim() ? `   ${line.trim()}` : '')
      }
      if (q.options) {
        out.push('   Options:')
        for (const o of q.options) out.push(`     - ${o.label}`)
      }
      out.push('')
    }
  }

  out.push('')
  out.push(`${'─'.repeat(70)}`)
  out.push('Keep the questions in this order and in these words. Answers are matched')
  out.push('back to the tool by position and wording, so a renamed question is a')
  out.push('question nobody can map to anything.')

  console.log(out.join('\n'))
}

main()
