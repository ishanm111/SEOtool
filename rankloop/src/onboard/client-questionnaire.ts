import type { BusinessType } from '../config'
import { questionsFor, type ClientFacts, type QuestionKind } from './questionnaire'

/**
 * The questionnaire as the business owner reads it.
 *
 * One source of the client-facing wording, because there are now two places a
 * business can answer these questions — the link the tool hosts itself, and a
 * Google Form built from the same definition — and the moment the two have
 * their own copy of a label they start to disagree about what was asked.
 *
 * Only the wording changes here. The key, the kind and the options are the
 * console's, so an answer typed by a business owner and an answer typed by an
 * operator are the same row in the same table and nothing downstream can tell
 * which it was.
 */

export type ClientQuestion = {
  key: string
  label: string
  help: string
  placeholder?: string
  kind: QuestionKind
  options?: { value: string; label: string }[]
  mustBeConfirmed?: boolean
  /** What is on file already, so a hosted form can show it rather than ask twice. */
  answer: string
}

export type ClientQuestionGroup = {
  title: string
  intro: string
  questions: ClientQuestion[]
}

/**
 * Questions the console words for an operator, reworded for the person who is
 * actually answering.
 *
 * "What do they most want to be found for?" is the right question and the wrong
 * pronoun: the business owner reading it is the "they". And "Anything the tool
 * must never claim" asks them to reason about a piece of software they have
 * never seen.
 */
const CLIENT_VOICE: Record<string, { label: string; help?: string }> = {
  street_address: {
    label: 'Street address',
    help: 'Leave this blank if you only travel to customers and have no address anyone would visit.',
  },
  postal_code: {
    label: 'ZIP / postal code',
    help: 'Goes in the same block as the address. It is what decides which local searches you come up in.',
  },
  support_hours: {
    label: 'When can a customer reach a person?',
    help: 'An online shop has no opening hours, but there is still a time when somebody answers. Customers ask this constantly and almost nobody puts it on their website.',
  },
  price_band: {
    label: 'Roughly how expensive are you?',
    help: 'Not a price — just the bracket search engines show next to a business.',
  },
  warranty: {
    label: 'Warranty or guarantee',
    help: 'In your own words, exactly as you would stand behind it. Left blank, every page that would have mentioned one stays unpublished.',
  },
  brands_carried: {
    label: 'Brands and ranges you actually stock',
    help: 'People ask for a brand, not a category. A brand nobody can find on your site cannot be recommended.',
  },
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
 * The group headings, reworded for the person answering.
 *
 * The console's intros explain to an operator why a question is worth asking —
 * structured data, map packs, what the tool will strike out. A business owner
 * reading "a warranty the business does not offer is a legal problem on their
 * website" is being talked about rather than to, and the heading above the
 * questions is the first thing on the page they read.
 */
const GROUP_VOICE: Record<string, { title?: string; intro: string }> = {
  'Where and when': {
    intro:
      'Search engines and AI assistants cannot place you anywhere without either a real address or the area you cover. For a shop, the address is also what gets you onto the map.',
  },
  'What it costs, and what you promise': {
    intro:
      'Nothing in this section is ever guessed. A price or a guarantee only goes on your website in the words you give here, because these are the ones customers hold you to.',
  },
  'Why a customer should pick them': {
    title: 'Why a customer should pick you',
    intro:
      'Specific numbers are the single biggest thing that gets a business named by an AI assistant; "best in town" measures as worth nothing. Anything here replaces the vague version.',
  },
  'Focus and competition': {
    intro:
      'This decides what we go looking for and who we measure you against. Reading your website only tells us what it happens to mention, which is rarely what you most want to sell.',
  },
}

/**
 * A claim that becomes binding once it is on the website is said so here too.
 *
 * The console marks these for the operator. The person actually making the
 * promise is the one reading this, so the warning belongs here more than it
 * does there.
 */
function describe(help: string, mustBeConfirmed?: boolean): string {
  if (!mustBeConfirmed) return help
  return `${help}\n\nThis will be published on your website as a commitment to customers, so only answer it with something you are happy to stand behind.`
}

/**
 * The groups to put in front of a business.
 *
 * `skipAnswered` is for a Google Form and nothing else. The Forms API cannot
 * seed an answer, so a form that included the answered questions would mean a
 * client retyping what the operator already knows — and a blank reply would be
 * indistinguishable from "it changed", which is how a good answer gets
 * overwritten with nothing.
 *
 * The tool's own page has no such limit: it shows every question with what is
 * on file already in the box, so a blank one unambiguously means "take that
 * off", and a business can correct a typo instead of living with it.
 */
export function clientQuestionGroups(
  businessType: BusinessType,
  facts: ClientFacts,
  opts: { skipAnswered?: boolean } = {},
): ClientQuestionGroup[] {
  const groups: ClientQuestionGroup[] = []

  for (const group of questionsFor(businessType)) {
    const asked = opts.skipAnswered
      ? group.questions.filter((q) => !facts[q.key])
      : group.questions
    if (asked.length === 0) continue

    const voicedGroup = GROUP_VOICE[group.title]

    groups.push({
      title: voicedGroup?.title ?? group.title,
      intro: voicedGroup?.intro ?? group.intro,
      questions: asked.map((q) => {
        const voiced = CLIENT_VOICE[q.key]
        return {
          key: q.key,
          label: voiced?.label ?? q.label,
          help: describe(voiced?.help ?? q.help, q.mustBeConfirmed),
          placeholder: q.placeholder,
          kind: q.kind,
          options: q.options,
          mustBeConfirmed: q.mustBeConfirmed,
          answer: facts[q.key] ?? '',
        }
      }),
    })
  }

  return groups
}

export function countQuestions(groups: ClientQuestionGroup[]): number {
  return groups.reduce((n, g) => n + g.questions.length, 0)
}

export function countAnswered(groups: ClientQuestionGroup[]): number {
  return groups.reduce((n, g) => n + g.questions.filter((q) => q.answer).length, 0)
}
