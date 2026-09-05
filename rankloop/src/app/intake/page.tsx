import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { activeClient } from '@/lib/active-client'
import { loadFacts } from '@/lib/facts'
import { questionsFor, QUESTIONNAIRE } from '@/onboard/questionnaire'
import { BUSINESS_TYPE_LABELS } from '@/config'
import { NoClient } from '../_components/no-client'
import { PageHeader, Stat } from '../_components/ui'
import { IntakeForm } from './form'

export const dynamic = 'force-dynamic'

/**
 * The client questionnaire, after onboarding.
 *
 * Separate from the fix list on purpose: these answers are gathered in a
 * conversation with the business, usually days before anyone looks at the
 * recommendations, and asking an operator to hunt for them inside a list of 177
 * proposed changes is how they never get filled in at all.
 */
export default async function IntakePage() {
  const client = await activeClient()
  if (!client) return <NoClient />

  const facts = loadFacts(db, client.id)
  const groups = questionsFor(client.businessType)
  const asked = groups.reduce((n, g) => n + g.questions.length, 0)
  const answered = groups.reduce(
    (n, g) => n + g.questions.filter((q) => facts[q.key]).length,
    0,
  )

  const blocked = db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.clientId, client.id))
    .all()
    .filter((r) => r.placeholderCount > 0).length

  return (
    <div className="space-y-8">
      <PageHeader
        title="Client questionnaire"
        subtitle={`The things about ${client.name} that cannot be read off their website. Every answer turns a blocked recommendation into one that can be published.`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Answered"
          value={`${answered}/${asked}`}
          hint="all optional, all editable later"
          tone={answered === asked ? 'good' : answered === 0 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Fixes still blocked"
          value={blocked}
          hint={blocked > 0 ? 'waiting on a fact from the business' : 'nothing is waiting on a fact'}
          tone={blocked > 0 ? 'warn' : 'good'}
        />
        <Stat
          label="Questions asked"
          value={asked}
          hint={`the ${BUSINESS_TYPE_LABELS[client.businessType].label.toLowerCase()} set`}
        />
      </div>

      {blocked > 0 && (
        <div className="rounded-xl border border-amber/25 bg-amber-soft p-5">
          <p className="text-sm font-semibold text-amber">
            {blocked} recommendations cannot be published as they stand
          </p>
          <p className="mt-1 text-sm text-ink-2">
            Each one contains a value only the business can confirm. Answering below and re-running
            the recommendations step resolves them in bulk.
          </p>
          <div className="mt-3 flex gap-2">
            <Link href="/fixes?show=blocked" className="btn btn-secondary btn-sm">
              See what is blocked
            </Link>
          </div>
        </div>
      )}

      <IntakeForm clientId={client.id} groups={groups} answers={facts} />

      <p className="text-sm text-ink-3">
        {QUESTIONNAIRE.reduce((n, g) => n + g.questions.length, 0)} questions exist in total; the
        ones shown are those that apply to a{' '}
        {BUSINESS_TYPE_LABELS[client.businessType].label.toLowerCase()}.
      </p>
    </div>
  )
}
