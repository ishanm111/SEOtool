import type { FormItem } from '../engines/google-forms'
import { questionsFor } from './questionnaire'
import type { Client } from '../lib/client'
import type { ClientFacts } from './questionnaire'

/**
 * The console questionnaire, rewritten as a Google Form a business owner can
 * fill in without an operator on the phone.
 *
 * Two things change in the translation, and both are deliberate.
 *
 * The console shows every question's `resolves` — "unblocks 8 recommendations"
 * — because that is what makes an operator bother to ask it. To the business
 * it is noise about someone else's tooling, so it is dropped and only the
 * question and its `help` survive.
 *
 * Questions already answered are left out entirely rather than pre-filled. The
 * Forms API cannot seed an answer, so including them would mean a client
 * retyping what the operator already knows, and a blank reply would be
 * indistinguishable from "it changed" — which is how good answers get
 * overwritten with nothing.
 */
export function formItemsFor(client: Client, facts: ClientFacts): FormItem[] {
  const items: FormItem[] = []

  for (const group of questionsFor(client.businessType)) {
    const unanswered = group.questions.filter((q) => !facts[q.key])
    if (unanswered.length === 0) continue

    items.push({ kind: 'header', title: group.title, description: group.intro })

    for (const q of unanswered) {
      const voiced = CLIENT_VOICE[q.key]
      items.push({
        kind: 'question',
        title: voiced?.label ?? q.label,
        description: describe(voiced?.help ?? q.help, q.mustBeConfirmed),
        type: q.kind === 'select' ? 'choice' : q.kind === 'textarea' ? 'paragraph' : 'short',
        options: q.options?.map((o) => o.label),
      })
    }
  }

  return items
}

/**
 * Questions the console words for an operator, reworded for the person who is
 * actually answering.
 *
 * "What do they most want to be found for?" is the right question and the wrong
 * pronoun: the business owner reading the form is the "they". And "Anything the
 * tool must never claim" asks them to reason about a piece of software they
 * have never seen. Only the wording changes; the key, the kind and the answer
 * all stay the same, so a form answer and an operator answer are interchangeable.
 */
const CLIENT_VOICE: Record<string, { label: string; help?: string }> = {
  priority_offerings: {
    label: 'What do you most want to be found for?',
    help: 'The two or three that pay best, not your full list.',
  },
  known_competitors: {
    label: 'Who do you lose work to?',
    help: 'Website addresses, comma-separated. We measure them alongside you, so a rival worth watching is never missed.',
  },
  must_not_claim: {
    label: 'Anything we must never say about you',
    help: 'Services you do not offer, areas you will not travel to, promises you cannot keep. This is a guardrail: nothing here will ever appear on your website.',
  },
  founded_year: {
    label: 'The year you started',
    help: 'Turns "trusted for years" into a number, which is what gets quoted.',
  },
}

/**
 * A claim that becomes binding once it is on the website is said so here too.
 *
 * The console marks these for the operator. The person actually making the
 * promise is the one reading this form, so the warning belongs here more than
 * it does there.
 */
function describe(help: string, mustBeConfirmed?: boolean): string {
  if (!mustBeConfirmed) return help
  return `${help}\n\nThis will be published on your website as a commitment to customers, so only answer it with something you are happy to stand behind.`
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
export function pendingQuestionCount(client: Client, facts: ClientFacts): number {
  return formItemsFor(client, facts).filter((i) => i.kind === 'question').length
}
