'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentPortalSession } from '@/portal/auth'
import { isDecision, recordDecision } from '@/portal/queries'

/**
 * Approving or rejecting a proposed change.
 *
 * The client id comes from the session and never from the form. The form
 * carries only which recommendation and which way, so the worst a tampered
 * submission can do is name a recommendation that belongs to someone else —
 * which matches no row, because the update is scoped by client id too.
 */
export async function decideAction(formData: FormData): Promise<void> {
  const session = await currentPortalSession()
  if (!session) redirect('/portal/login')

  const id = Number(formData.get('recommendationId'))
  const decision = String(formData.get('decision') ?? '')

  if (!Number.isInteger(id) || !isDecision(decision)) return

  recordDecision(session.client.id, id, decision, session.email)
  revalidatePath('/portal/fixes')
  revalidatePath('/portal')
}
