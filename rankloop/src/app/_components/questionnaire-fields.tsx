import type { QuestionGroup } from '@/onboard/questionnaire'

/**
 * The intake questions, rendered as plain fields.
 *
 * Every one is optional and every one says what it unblocks, because that is
 * the only thing that gets it answered: "warranty terms" is a chore, "this
 * removes 8 blocked recommendations" is a reason.
 *
 * Shared by the add-a-client screen and the standalone intake page so the two
 * can never ask a question in two different ways.
 */
export function QuestionnaireFields({
  groups,
  answers = {},
  sources = {},
}: {
  groups: QuestionGroup[]
  answers?: Record<string, string>
  /**
   * Where a prefilled answer came from, by question key.
   *
   * Shown next to the field rather than left implicit: a box that filled
   * itself and said nothing about it is a box nobody checks, and everything
   * read off a listing is a suggestion until a person confirms it.
   */
  sources?: Record<string, string>
}) {
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <fieldset key={group.title}>
          <legend className="display text-base">{group.title}</legend>
          <p className="mt-1 mb-4 text-sm text-ink-3">{group.intro}</p>

          <div className="space-y-5">
            {group.questions.map((q) => {
              const id = `fact_${q.key}`
              const value = answers[q.key] ?? ''
              return (
                <div key={q.key}>
                  <label htmlFor={id} className="field-label">
                    {q.label}
                    {q.mustBeConfirmed && (
                      <span className="ml-2 rounded bg-amber-soft px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-amber">
                        confirm in writing
                      </span>
                    )}
                  </label>

                  {q.kind === 'textarea' ? (
                    <textarea
                      id={id}
                      name={id}
                      rows={2}
                      className="field"
                      placeholder={q.placeholder}
                      defaultValue={value}
                    />
                  ) : q.kind === 'select' ? (
                    <select id={id} name={id} className="field" defaultValue={value}>
                      {(q.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={id}
                      name={id}
                      className="field"
                      placeholder={q.placeholder}
                      defaultValue={value}
                    />
                  )}

                  {sources[q.key] && (
                    <p className="mt-1.5 text-xs text-sky">
                      Filled in from what was {sources[q.key]} — check it, and change it if it is
                      wrong or out of date.
                    </p>
                  )}
                  <p className="mt-1.5 text-xs text-ink-3">{q.help}</p>
                  {q.resolves && (
                    <p className="mt-0.5 text-xs text-moss-deep">Answering this fills in {q.resolves}.</p>
                  )}
                </div>
              )
            })}
          </div>
        </fieldset>
      ))}
    </div>
  )
}
