import type { Metadata } from 'next'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { loadFacts } from '@/lib/facts'
import {
  clientQuestionGroups,
  countAnswered,
  countQuestions,
} from '@/onboard/client-questionnaire'
import type { BusinessType } from '@/config'
import { QuestionnaireForm } from './form'

export const dynamic = 'force-dynamic'

/**
 * Never indexed, on any deployment.
 *
 * The link is the only credential on this page, and a search engine that
 * crawled one would publish a business's answers to anyone who searched for
 * them.
 */
export const metadata: Metadata = {
  title: 'A few questions about your business',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * The questionnaire, hosted by the tool, opened with a link and no password.
 *
 * Outside both route groups on purpose: a business owner answering questions is
 * neither an operator nor a signed-in portal user, and this page has no nav, no
 * client switcher and nothing to sign out of. The token in the URL is the whole
 * of the authorisation, which is the same trust model as the Google Form link
 * this replaces — with the difference that the answers land in the table the
 * recommender reads instead of a spreadsheet somebody has to copy out by hand.
 */
export default async function HostedQuestionnaire({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const client = db
    .select({
      id: schema.clients.id,
      name: schema.clients.name,
      businessType: schema.clients.businessType,
    })
    .from(schema.clients)
    .where(eq(schema.clients.questionnaireToken, token))
    .get()

  if (!client) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
        <div className="eyebrow">SEOmyze</div>
        <h1 className="display mt-1 text-3xl text-pine-deep">This link is not valid</h1>
        <p className="mt-3 text-sm text-ink-2">
          It may have been replaced by a newer one. Ask whoever sent it to you for the current
          link — nothing you have typed has been lost, because this page never opened.
        </p>
      </main>
    )
  }

  const facts = loadFacts(db, client.id)
  const groups = clientQuestionGroups(client.businessType as BusinessType, facts)
  const asked = countQuestions(groups)
  const answered = countAnswered(groups)

  return (
    <main className="mx-auto max-w-2xl px-5 py-10 sm:px-8">
      <header className="border-b border-line pb-6">
        <div className="eyebrow">SEOmyze</div>
        <h1 className="display mt-1 text-3xl text-pine-deep">{client.name}</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          These are the things about your business that cannot be read off your website, and
          every one of them is something an AI assistant looks for when it decides which
          business to recommend.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          Every question is optional — answer what you can and skip the rest. Nothing you write
          here goes on your website until you have been shown it first.
        </p>
        <p className="mt-4 text-sm text-ink-3">
          {answered} of {asked} answered.{' '}
          {answered > 0 && 'What is already filled in is yours to change.'}
        </p>
      </header>

      <div className="mt-6">
        <QuestionnaireForm token={token} groups={groups} />
      </div>
    </main>
  )
}
