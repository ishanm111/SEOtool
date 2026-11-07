'use server'

import { redirect } from 'next/navigation'
import { currentPortalSession, setPassword, signIn, signOut } from '@/portal/auth'
import type { PortalFormState } from './form-state'

/**
 * Signing in and out of the client portal.
 *
 * Both redirect rather than return on success: a client who has just signed in
 * should land on their own numbers, and a client who has signed out should not
 * be left looking at a page rendered from the session they just ended.
 */

export async function signInAction(
  _prev: PortalFormState,
  formData: FormData,
): Promise<PortalFormState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  let result
  try {
    result = await signIn(email, password)
  } catch (err) {
    // A missing PORTAL_SECRET lands here. The client cannot fix it, so they get
    // a plain apology while the operator gets the real reason in the log.
    console.error('[portal] sign-in failed:', err)
    return { error: 'Sign-in is not available right now. Please tell your contact.', notice: null }
  }

  if (!result.ok) return { error: result.error, notice: null }

  redirect(result.mustChangePassword ? '/portal/password' : '/portal')
}

export async function signOutAction(): Promise<void> {
  await signOut()
  redirect('/portal/login')
}

/**
 * Changing a password.
 *
 * The current password is required even though the session already proves who
 * this is: a portal left open on a shop counter is the realistic threat, and
 * asking for it costs a signed-in owner one field.
 */
export async function changePasswordAction(
  _prev: PortalFormState,
  formData: FormData,
): Promise<PortalFormState> {
  const session = await currentPortalSession()
  if (!session) redirect('/portal/login')

  const current = String(formData.get('current') ?? '')
  const next = String(formData.get('next') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (next.length < 10) {
    return { error: 'Use at least 10 characters.', notice: null }
  }
  if (next !== confirm) {
    return { error: 'The two new passwords do not match.', notice: null }
  }

  const check = await signIn(session.email, current)
  if (!check.ok) {
    return { error: 'That is not your current password.', notice: null }
  }

  setPassword(session.userId, next)
  return { error: null, notice: 'Password changed.' }
}
