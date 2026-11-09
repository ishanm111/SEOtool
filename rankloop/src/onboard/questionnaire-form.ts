import type { FormItem } from '../engines/google-forms'
import type { Client } from '../lib/client'
import type { ClientFacts } from './questionnaire'
import { clientQuestionGroups, countQuestions } from './client-questionnaire'

/**
 * The client questionnaire, rewritten as a Google Form a business owner can
 * fill in without an operator on the phone.
 *
 * The wording and the choice of what to ask both live in
 * `client-questionnaire.ts`, shared with the page the tool hosts itself. All
 * this module does is translate those groups into the shapes the Forms API
 * accepts — and drop each question's `resolves`, which says "unblocks 8
 * recommendations" and is noise about someone else's tooling to the business.
 *
 * Every question goes in, answered or not. The client is the one who knows
 * whether what we hold is still true, and an answer that comes back changed is
 * shown as replacing the old one before anything is written.
 */
export function formItemsFor(client: Client, facts: ClientFacts): FormItem[] {
  const items: FormItem[] = []

  for (const group of clientQuestionGroups(client.businessType, facts)) {
    items.push({ kind: 'header', title: group.title, description: group.intro })

    for (const q of group.questions) {
      items.push({
        kind: 'question',
        title: q.label,
        description: q.help,
        type: q.kind === 'select' ? 'choice' : q.kind === 'textarea' ? 'paragraph' : 'short',
        options: q.options?.map((o) => o.label),
      })
    }
  }

  return items
}

export function formTitleFor(client: Client): string {
  return `${client.name} — a few questions about your business`
}

export function formDescriptionFor(client: Client): string {
  return [
    `These are the things about ${client.name} that cannot be read off your website, and every one of them is something an AI assistant looks for when deciding which business to recommend.`,
    '',
    'Every question is optional. Answer what you can and skip the rest — a half-filled form is genuinely useful.',
    '',
    'Nothing you write here is published without being shown to you first.',
  ].join('\n')
}

/** How many questions a form would carry, for an interface that says so first. */
export function formQuestionCount(client: Client, facts: ClientFacts): number {
  return countQuestions(clientQuestionGroups(client.businessType, facts))
}
