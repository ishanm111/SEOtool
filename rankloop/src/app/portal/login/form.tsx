'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { signInAction } from '../_actions/auth'
import { emptyPortalFormState } from '../_actions/form-state'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn btn-primary w-full justify-center" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  )
}

export function SignInForm() {
  const [state, action] = useActionState(signInAction, emptyPortalFormState)

  return (
    <form action={action} className="space-y-4 rounded-lg border border-line bg-card p-6">
      <label className="block">
        <span className="eyebrow">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="mt-1 w-full rounded border border-line bg-white px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="eyebrow">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded border border-line bg-white px-3 py-2 text-sm"
        />
      </label>

      {state.error && (
        <p className="rounded border border-rose/30 bg-rose-soft p-3 text-sm">{state.error}</p>
      )}

      <Submit />
    </form>
  )
}
