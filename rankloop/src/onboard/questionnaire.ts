import type { BusinessType } from '../config'

/**
 * The questions only the business can answer.
 *
 * The recommender refuses to invent a price, a warranty, a response time or a
 * credential — it emits a visible `[[FILL: …]]` marker instead, and that marker
 * blocks publication. Most of a fix list ends up waiting on a handful of facts
 * that one conversation with the client would settle.
 *
 * So these are asked once, up front, and every answer removes a specific
 * placeholder. Nothing here is industry-specific: no question assumes a trade, a
 * product, or a country, and every one of them is optional — a half-filled
 * questionnaire is strictly better than none.
 *
 * `resolves` is shown in the interface. An operator who can see that a question
 * turns 8 blocked recommendations into publishable copy actually asks it.
 */

export type QuestionKind = 'text' | 'textarea' | 'select'

export type Question = {
  key: string
  label: string
  /** Why it is being asked, in the words used with the client. */
  help: string
  placeholder?: string
  kind: QuestionKind
  options?: { value: string; label: string }[]
  /**
   * Which kinds of business the question makes sense for.
   *
   * A service business and a shop are asked genuinely different things. Postage
   * is meaningless to a plumber, a response time is meaningless to a liquor
   * store, and asking either of them the other's questions is how a
   * questionnaire stops being answered at all.
   */
  appliesTo: BusinessType[] | 'all'
  /**
   * Ways of answering, offered as a completion the operator can take with Tab.
   *
   * Frames, not answers. Every number, price, period and licence body in one is
   * written as an ellipsis, because a suggestion that reads "90 days on labour"
   * is a fact about a business nobody asked — and the whole point of this
   * questionnaire is that the tool never states one of those on its own. What a
   * frame saves is the shape of a good answer: the units, the second half an
   * operator forgets, the "and what changes it" a bare price leaves out.
   */
  frames?: string[]
  /**
   * The same question, worded for a different kind of business.
   *
   * A question can be right for all three and still read as though it were
   * written for one of them. "What does a typical job cost, and what changes
   * the price?" is exactly the right question to put to a shop, but the example
   * under it talked about call-outs and parts, and an operator reading that
   * concludes the question is not for them and skips it. Only the wording
   * changes here; which kinds are asked at all is `appliesTo`.
   */
  variants?: Partial<Record<BusinessType, QuestionVariant>>
  /** What answering it unblocks. Empty when it only informs the operator. */
  resolves: string
  /**
   * A claim that becomes legally binding once published. Marked so the
   * interface can say plainly that the business has to confirm it in writing.
   */
  mustBeConfirmed?: boolean
}

/** The parts of a question that may be reworded per kind of business. */
export type QuestionVariant = Partial<Pick<Question, 'label' | 'help' | 'placeholder' | 'frames'>>

export type QuestionGroup = {
  title: string
  intro: string
  questions: Question[]
}

export const QUESTIONNAIRE: QuestionGroup[] = [
  {
    title: 'Where and when',
    intro:
      'Structured data needs a real address or an explicit service area. Without it the engines cannot place the business anywhere — and for a shop, the address is what gets it into the map pack at all.',
    questions: [
      {
        key: 'street_address',
        label: 'Street address',
        help: 'Leave blank if the business only travels to customers and has no address a customer could visit.',
        placeholder: '123 Main St',
        kind: 'text',
        appliesTo: ['local_service', 'local_retail'],
        resolves: 'the street address in LocalBusiness structured data',
      },
      {
        key: 'postal_code',
        label: 'ZIP / postal code',
        help: 'Part of the same structured data block. Engines use it to decide which searches a business is local to.',
        placeholder: '77502',
        kind: 'text',
        appliesTo: ['local_service', 'local_retail'],
        resolves: 'the postal code in LocalBusiness structured data',
      },
      {
        key: 'opening_hours',
        label: 'Opening hours',
        help: 'Written the way you would say them out loud. "Closed Sunday" is worth stating — it is a question customers ask.',
        placeholder: 'Mon–Fri 8am–6pm, Sat 9am–2pm, closed Sunday',
        kind: 'textarea',
        appliesTo: ['local_service', 'local_retail'],
        frames: [
          'Mon–Fri …–…, Sat …–…, closed Sunday',
          'Open …–… every day',
          'By appointment only',
        ],
        resolves: 'the opening-hours answer on every new location page',
      },
      {
        key: 'support_hours',
        label: 'When can a customer reach a person?',
        help: 'An online store has no opening hours, but it does have a time when somebody answers. It is asked of the engines constantly and almost never on the site.',
        placeholder: 'Email answered Mon–Fri, usually within a few hours; no phone line',
        kind: 'textarea',
        appliesTo: ['ecommerce'],
        resolves: 'the contact answer on new pages',
      },
      {
        key: 'response_time',
        label: 'How quickly do you normally get to a customer?',
        help: 'The single most repeated missing fact. Give the honest typical case and the worst case you would still stand behind.',
        placeholder: 'Usually the same day, and always within 48 hours',
        kind: 'textarea',
        appliesTo: ['local_service'],
        frames: [
          'Usually the same day, and always within … hours',
          'Same day for emergencies; otherwise within … working days',
          'Within … hours on weekdays, next working day at the weekend',
        ],
        resolves: 'the response-time sentence in body copy and on every new page',
      },
      {
        key: 'access_notes',
        label: 'Anything a first-time visitor should know',
        help: 'Parking, which door to use, a hard-to-find entrance. Only relevant if customers come to you.',
        placeholder: 'Free parking at the rear; entrance is on the side street',
        kind: 'textarea',
        appliesTo: ['local_service', 'local_retail'],
        frames: [
          'Free parking at the rear; the entrance is on …',
          'Street parking only; the door is …',
          'Inside …, on the … floor',
        ],
        resolves: 'the access note on new location pages',
      },
    ],
  },
  {
    title: 'What it costs, and what you promise',
    intro:
      'Nothing here is ever invented. A wrong price or a warranty the business does not offer is a legal problem on their website, not a style one.',
    questions: [
      {
        key: 'price_band',
        label: 'Rough price band',
        help: 'The bracket search engines display. Not a price — just where the business sits.',
        kind: 'select',
        options: [
          { value: '', label: 'Not sure / skip' },
          { value: '$', label: '$ — budget' },
          { value: '$$', label: '$$ — mid-range' },
          { value: '$$$', label: '$$$ — premium' },
          { value: '$$$$', label: '$$$$ — high end' },
        ],
        appliesTo: 'all',
        resolves: 'the price range in structured data',
      },
      {
        key: 'price_detail',
        label: 'What does a typical job or order cost, and what changes the price?',
        help: 'A range is fine, and honest ranges outperform "call for a quote" — it is one of the questions customers ask an AI directly.',
        placeholder: 'Most call-outs land between $120 and $260; the difference is usually the part',
        kind: 'textarea',
        appliesTo: 'all',
        frames: [
          'Most jobs land between $… and $…; the difference is usually …',
          'A call-out is $…, taken off the price of the work if you go ahead',
          'Priced per …, from $…',
        ],
        variants: {
          local_retail: {
            label: 'What does a typical customer spend, and what changes it?',
            help: 'A range by category, never a price list — prices move and this gets published. "Is it expensive?" is one of the questions customers put to an AI before deciding where to drive.',
            placeholder: 'Most of what we sell is $15–$80; the top end is the imported stock, and a case of six is 10% off',
            frames: [
              'Most of what we stock is between $… and $…; the pricier end is …',
              'A case of … is …% off',
              'Everything on the shelf is between $… and $…',
            ],
          },
          ecommerce: {
            label: 'What does a typical order cost, and what changes the price?',
            help: 'A range is fine, and honest ranges outperform "prices vary" — it is one of the questions customers ask an AI directly.',
            placeholder: 'Most orders land between $40 and $120; the difference is usually the size',
            frames: [
              'Most orders land between $… and $…; the difference is usually …',
              'Priced per …, from $…',
              'Free delivery over $…',
            ],
          },
        },
        resolves: 'the pricing answer on new pages and buying guides',
        mustBeConfirmed: true,
      },
      {
        key: 'currency',
        label: 'Currency',
        help: 'Product structured data will not validate without it.',
        placeholder: 'USD',
        kind: 'text',
        appliesTo: ['ecommerce', 'local_retail'],
        frames: [
          'USD',
          'CAD',
          'GBP',
          'EUR',
          'AUD',
        ],
        resolves: 'the currency code in Product structured data',
      },
      {
        key: 'warranty',
        label: 'Warranty or guarantee',
        help: 'In the exact words the business would stand behind. Left blank, every page that would mention one stays blocked.',
        placeholder: '90 days on labour, manufacturer warranty on parts',
        kind: 'textarea',
        appliesTo: 'all',
        frames: [
          '… days on labour, manufacturer warranty on parts',
          '… year guarantee on the work',
          'No warranty is offered',
        ],
        variants: {
          local_retail: {
            label: 'Guarantee on what you sell',
            help: 'What happens when something is faulty. In the exact words the business would stand behind — left blank, every page that would mention one stays blocked.',
            placeholder: 'Manufacturer warranty on everything; anything faulty exchanged within 30 days with the receipt',
            frames: [
              'Manufacturer warranty on everything we sell',
              'Anything faulty exchanged within … days with the receipt',
              'No guarantee beyond the manufacturer&rsquo;s',
            ],
          },
          ecommerce: {
            label: 'Guarantee on what you sell',
            help: 'What happens when something arrives faulty or fails later. In the exact words the business would stand behind.',
            placeholder: 'Manufacturer warranty on everything; faulty on arrival is replaced and we pay the postage',
            frames: [
              'Manufacturer warranty on everything we sell',
              'Faulty on arrival is replaced, and we pay the return postage',
              '… year guarantee, claimed through us rather than the maker',
            ],
          },
        },
        resolves: 'the warranty answer on new pages',
        mustBeConfirmed: true,
      },
      {
        key: 'returns',
        label: 'Returns window and conditions',
        help: 'What a customer actually gets, including anything that voids it.',
        placeholder: '30 days unworn, in the original box, buyer pays return postage',
        kind: 'textarea',
        appliesTo: ['ecommerce', 'local_retail'],
        frames: [
          '… days, unused and in the original packaging; the buyer pays return postage',
          '… days, no questions asked, refund to the original payment method',
          'No returns on …',
        ],
        resolves: 'the returns answer on new pages',
        mustBeConfirmed: true,
      },
      {
        key: 'shipping',
        label: 'Delivery: how long, how much, and where to',
        help: 'The most asked question about any online store, and the one an engine will answer from a rival\'s site if it cannot find it on yours.',
        placeholder: '2–4 working days, free over $50, US only',
        kind: 'textarea',
        appliesTo: ['ecommerce'],
        resolves: 'the delivery answer on new pages and in Product structured data',
        mustBeConfirmed: true,
      },
      {
        key: 'click_and_collect',
        label: 'Can people order ahead and collect in the shop?',
        help: 'Say plainly if not. "Can I reserve one and pick it up?" is a question customers put to an engine before they get in the car.',
        placeholder: 'Call ahead and we will hold it for the day; no online ordering',
        kind: 'textarea',
        appliesTo: ['local_retail'],
        resolves: 'the ordering answer on new pages',
        mustBeConfirmed: true,
      },
      {
        key: 'brands_carried',
        label: 'Brands and ranges actually stocked',
        help: 'People ask an engine where to buy a brand, not where to buy a category. A brand nobody can find on the site cannot be recommended.',
        placeholder: 'Herradura, Don Julio, most Texas craft beer',
        kind: 'textarea',
        appliesTo: ['ecommerce', 'local_retail'],
        resolves: 'the stocked-brands list on new pages',
      },
    ],
  },
  {
    title: 'Why a customer should pick them',
    intro:
      'Concrete numbers are the biggest measured lever in AI visibility, and superlatives measure neutral-to-negative. Anything here replaces a "best in town" the tool would otherwise strike out.',
    questions: [
      {
        key: 'founded_year',
        label: 'Year the business started',
        help: 'Turns "trusted for years" into a number, which is the whole point.',
        placeholder: '2011',
        kind: 'text',
        appliesTo: 'all',
        resolves: 'a verifiable fact in place of struck-out superlatives',
      },
      {
        key: 'credentials',
        label: 'Licences, certifications and insurance',
        help: 'Anything with a number or an issuing body. Vague trust language is worth nothing; a licence number is worth a lot.',
        placeholder: 'TDLR licence #12345, fully insured, factory-certified for Bosch',
        kind: 'textarea',
        appliesTo: 'all',
        frames: [
          'Licence #…, issued by …; fully insured',
          '… certified, public liability cover to $…',
          'Insured; no licence is required for this work in …',
        ],
        variants: {
          local_retail: {
            help: 'Anything with a number or an issuing body — a trading licence, an age-restricted-sales permit, food handling, insurance. Vague trust language is worth nothing; a licence number is worth a lot.',
            placeholder: 'State licence #12345, food handling certified, fully insured',
            frames: [
              'Licence #…, issued by …; fully insured',
              '… certified, public liability cover to $…',
              'Insured; no licence is required for what we sell in …',
            ],
          },
          ecommerce: {
            help: 'Anything with a number or an issuing body — company registration, an industry body, a certification the products carry.',
            placeholder: 'Registered company #12345678; member of …',
            frames: [
              'Registered company #…',
              'Member of …, since …',
              'Everything we sell is … certified',
            ],
          },
        },
        resolves: 'credibility claims that would otherwise be blocked',
        mustBeConfirmed: true,
      },
      {
        key: 'proof_points',
        label: 'Numbers you can prove',
        help: 'Jobs completed, years running, response times, units shipped. Each one is a statistic the engines can quote.',
        placeholder: '4,000 repairs since 2011; 92% fixed on the first visit',
        kind: 'textarea',
        appliesTo: 'all',
        frames: [
          '… jobs completed since …',
          '…% fixed on the first visit',
          'Average response time of … minutes, measured across … calls',
        ],
        variants: {
          local_retail: {
            placeholder: 'Family-run since 2009; over 600 lines in stock',
            frames: [
              'Family-run since …',
              '… lines in stock, more than any shop within … miles',
              'Serving … since …',
            ],
          },
          ecommerce: {
            placeholder: '12,000 orders shipped since 2018; 98% dispatched the next working day',
            frames: [
              '… orders shipped since …',
              '…% dispatched the next working day',
              'Average rating of … across … reviews',
            ],
          },
        },
        resolves: 'statistics in rewritten body copy',
        mustBeConfirmed: true,
      },
      {
        key: 'must_not_claim',
        label: 'Anything the tool must never claim',
        help: 'Services they do not offer, areas they will not travel to, promises they cannot keep. This is a guardrail, not a wish list.',
        placeholder: 'We do not do commercial work, and never claim 24/7',
        kind: 'textarea',
        appliesTo: 'all',
        frames: [
          'We do not do commercial work',
          'Never claim availability we do not have — no 24/7, no same-day guarantee',
          'Do not mention …',
        ],
        resolves: '',
      },
    ],
  },
  {
    title: 'Focus and competition',
    intro:
      'Shapes what gets asked and who gets crawled. Detection reads what the site happens to mention, which is rarely what the business actually wants to sell.',
    questions: [
      {
        key: 'priority_offerings',
        label: 'What do they most want to be found for?',
        help: 'The two or three that pay best, not the full list. These get weighted in the question set.',
        placeholder: 'Refrigerator repair, same-day washer repair',
        kind: 'textarea',
        appliesTo: 'all',
        // Read by the operator when reviewing the generated question set rather
        // than consumed automatically — saying otherwise would overstate it.
        resolves: '',
      },
      {
        key: 'known_competitors',
        label: 'Who do they lose work to?',
        help: 'Website addresses, comma-separated. These get crawled and measured alongside whoever the engines name, so a rival the engines never cite is still profiled.',
        placeholder: 'rivalcompany.com, anotherone.com',
        kind: 'textarea',
        appliesTo: 'all',
        resolves: 'the competitor crawl — these get profiled on every run',
      },
    ],
  },
]

/** The questions that make sense for one kind of business. */
export function questionsFor(businessType: BusinessType): QuestionGroup[] {
  return QUESTIONNAIRE.map((group) => ({
    ...group,
    questions: group.questions
      .filter((q) => q.appliesTo === 'all' || q.appliesTo.includes(businessType))
      // Reworded for this kind where a variant exists, and left alone where the
      // one wording genuinely suits all three.
      .map((q) => ({ ...q, ...(q.variants?.[businessType] ?? {}) })),
  })).filter((group) => group.questions.length > 0)
}

export const ALL_QUESTION_KEYS = QUESTIONNAIRE.flatMap((g) => g.questions.map((q) => q.key))

export function questionByKey(key: string): Question | undefined {
  for (const g of QUESTIONNAIRE) {
    const hit = g.questions.find((q) => q.key === key)
    if (hit) return hit
  }
  return undefined
}

/**
 * The answers, as the recommender consumes them.
 *
 * A blank answer is dropped rather than stored as an empty string, so every
 * consumer can treat "absent" as the single meaning of "not answered".
 */
export type ClientFacts = Record<string, string>

export function factsFromEntries(entries: { key: string; value: string }[]): ClientFacts {
  const out: ClientFacts = {}
  for (const { key, value } of entries) {
    const trimmed = value.trim()
    if (trimmed) out[key] = trimmed
  }
  return out
}
