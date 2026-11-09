'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { answerAction } from '../_actions/answer'
import { emptyAnswerState } from '../_actions/state'
import type { ClientQuestionGroup } from '@/onboard/client-questionnaire'

/**
 * The questionnaire as the business fills it in.
 *
 * Every box starts with whatever is already on file, which is the one thing a
 * Google Form cannot do: a business owner correcting the opening hours should
 * see the wrong ones, not an empty box and a guess at what was there. Clearing
 * a box therefore means "take that off", unambiguously, and saving again is
 * safe at any point.
 *
 * Nothing is required. A half-filled questionnaire is worth more than an
 * abandoned one, and the submit button never argues about it.
 */

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending && <span className="h-1.5 w-1.5 rounded-full bg-current live-dot" aria-hidden />}
      {pending ? 'Saving…' : 'Save my answers'}
    </button>
  )
}

function Field({ question }: { question: ClientQuestionGroup['questions'][number] }) {
  const id = `fact_${question.key}`
  const shared =
    'mt-2 w-full rounded-lg border border-line bg-card px-3 py-2 text-base outline-none focus:border-pine'

  return (
    <div className="border-t border-line pt-5 first:border-0 first:pt-0">
      <label htmlFor={id} className="block font-medium">
        {question.label}
      </label>
      {question.help && (
        <p className="mt-1 text-sm whitespace-pre-wrap text-ink-3">{question.help}</p>
      )}

      {question.kind === 'textarea' ? (
        <textarea
          id={id}
          name={id}
          rows={3}
          defaultValue={question.answer}
          placeholder={question.placeholder}
          className={shared}
        />
      ) : question.kind === 'select' ? (
        <select id={id} name={id} defaultValue={question.answer} className={shared}>
          <option value="">No answer</option>
          {question.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          name={id}
          type="text"
          defaultValue={question.answer}
          placeholder={question.placeholder}
          className={shared}
        />
      )}
    </div>
  )
}

export function QuestionnaireForm({
  token,
  groups,
}: {
  token: string
  groups: ClientQuestionGroup[]
}) {
  const [state, action] = useActionState(answerAction, emptyAnswerState)

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="token" value={token} />

      {groups.map((group) => (
        <section key={group.title} className="rounded-lg border border-line bg-card p-5">
          <h2 className="display text-xl">{group.title}</h2>
          <p className="mt-1 text-sm text-ink-3">{group.intro}</p>

          <div className="mt-5 space-y-5">
            {group.questions.map((q) => (
              <Field key={q.key} question={q} />
            ))}
          </div>
        </section>
      ))}

      {state.error && (
        <p className="rounded border border-rose/30 bg-rose-soft p-3 text-sm whitespace-pre-wrap">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p className="rounded border border-pine/30 bg-pine-soft p-3 text-sm">{state.notice}</p>
      )}

      {/* Sticky, because this form is long on a phone and the button is the
          only thing on it that does anything. */}
      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-3 border-t border-line bg-sink/95 px-1 py-4 backdrop-blur">
        <Submit />
        <span className="text-sm text-ink-3">
          Every question is optional, and you can come back to this link later.
        </span>
      </div>
    </form>
  )
}
