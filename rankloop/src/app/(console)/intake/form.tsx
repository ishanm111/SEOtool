'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { saveFactsAction, type FactsState } from '../_actions/facts'
import { QuestionnaireFields } from '../_components/questionnaire-fields'
import type { QuestionGroup } from '@/onboard/questionnaire'

function Save() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending && <span className="h-1.5 w-1.5 rounded-full bg-current live-dot" aria-hidden />}
      {pending ? 'Saving…' : 'Save answers'}
    </button>
  )
}

export function IntakeForm({
  clientId,
  groups,
  answers,
}: {
  clientId: number
  groups: QuestionGroup[]
  answers: Record<string, string>
}) {
  const [state, action] = useActionState<FactsState, FormData>(saveFactsAction, {
    notice: null,
    error: null,
  })

  return (
    <form action={action} className="card space-y-8 p-6">
      <input type="hidden" name="clientId" value={clientId} />

      <QuestionnaireFields groups={groups} answers={answers} />

      {state.error && (
        <p className="rounded-lg border border-rose/25 bg-rose-soft p-3 text-sm text-rose">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className="rounded-lg border border-moss/25 bg-moss-soft p-3 text-sm text-moss-deep">
          {state.notice}
        </p>
      )}

      <div className="border-t border-line pt-5">
        <Save />
      </div>
    </form>
  )
}
