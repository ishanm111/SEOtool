'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { changePasswordAction } from '../../_actions/auth'
import { emptyPortalFormState } from '../../_actions/form-state'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Saving…' : 'Change password'}
    </button>
  )
}

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, emptyPortalFormState)

  return (
    <form action={action} className="space-y-4 rounded-lg border border-line bg-card p-6">
      <label className="block">
        <span className="eyebrow">Current password</span>
        <input
          name="current"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded border border-line bg-white px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="eyebrow">New password</span>
        <input
          name="next"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          className="mt-1 w-full rounded border border-line bg-white px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="eyebrow">New password again</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          className="mt-1 w-full rounded border border-line bg-white px-3 py-2 text-sm"
        />
      </label>

      {state.error && (
        <p className="rounded border border-rose/30 bg-rose-soft p-3 text-sm">{state.error}</p>
      )}
      {state.notice && (
        <p className="rounded border border-pine/30 bg-pine-soft p-3 text-sm">{state.notice}</p>
      )}

      <Submit />
    </form>
  )
}
