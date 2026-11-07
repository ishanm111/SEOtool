'use server'

import { revalidatePath } from 'next/cache'
import type { FixState } from './form-state'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { editorFor, type EditableField } from '@/editor'
import { credentialFor } from '@/lib/fix-queries'

/**
 * Connecting a client's website, and writing approved changes to it.
 *
 * Every write records what was there before it, so nothing published from here
 * is one-way. A failed write is recorded too: an operator needs to know that a
 * fix was attempted and did not land, which is a different situation from one
 * that was never tried.
 */

export type { FixState } from './form-state'

export async function saveCredentialAction(
  _prev: FixState,
  formData: FormData,
): Promise<FixState> {
  const clientId = Number(formData.get('clientId'))
  if (!Number.isInteger(clientId)) return { error: 'No client was given.', notice: null }

  const kind = String(formData.get('kind') ?? '')
  if (kind !== 'wordpress' && kind !== 'shopify') {
    return { error: 'Pick which kind of site this is.', notice: null }
  }

  const endpoint = String(formData.get('endpoint') ?? '').trim()
  const username = String(formData.get('username') ?? '').trim()
  const secret = String(formData.get('secret') ?? '').trim()

  if (!endpoint) return { error: 'The site address is needed.', notice: null }
  if (!secret) {
    return {
      error:
        kind === 'wordpress'
          ? 'The application password is needed.'
          : 'The Admin API access token is needed.',
      notice: null,
    }
  }
  if (kind === 'wordpress' && !username) {
    return { error: 'WordPress needs the username the application password belongs to.', notice: null }
  }

  const existing = credentialFor(clientId)
  const values = { clientId, kind, endpoint, username, secret, status: 'untested', detail: null }

  const id = existing
    ? (db.update(schema.siteCredentials).set(values).where(eq(schema.siteCredentials.id, existing.id)).run(),
      existing.id)
    : db
        .insert(schema.siteCredentials)
        .values(values)
        .returning({ id: schema.siteCredentials.id })
        .all()[0].id

  // Saved and checked in one press: a credential that has not been proven to
  // work is indistinguishable from one that does not, right up until a fix
  // silently fails to publish.
  const result = await runCheck(id)
  revalidatePath('/fixes')
  revalidatePath('/clients')
  return result.ok
    ? { error: null, notice: result.detail }
    : { error: result.detail, notice: null }
}

async function runCheck(credentialId: number): Promise<{ ok: boolean; detail: string }> {
  const cred = db
    .select()
    .from(schema.siteCredentials)
    .where(eq(schema.siteCredentials.id, credentialId))
    .all()[0]
  if (!cred) return { ok: false, detail: 'That connection no longer exists.' }

  const editor = editorFor(cred)
  if (!editor) return { ok: false, detail: `No editor exists for a ${cred.kind} site.` }

  let outcome: { ok: boolean; detail: string }
  try {
    outcome = await editor.check()
  } catch (err) {
    outcome = {
      ok: false,
      detail: `The site could not be reached: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  db.update(schema.siteCredentials)
    .set({ status: outcome.ok ? 'ok' : 'failed', detail: outcome.detail, checkedAt: new Date() })
    .where(eq(schema.siteCredentials.id, credentialId))
    .run()

  return outcome
}

export async function testCredentialAction(
  _prev: FixState,
  formData: FormData,
): Promise<FixState> {
  const id = Number(formData.get('credentialId'))
  if (!Number.isInteger(id)) return { error: 'No connection was given.', notice: null }
  const result = await runCheck(id)
  revalidatePath('/fixes')
  return result.ok ? { error: null, notice: result.detail } : { error: result.detail, notice: null }
}

export async function disconnectAction(formData: FormData) {
  const id = Number(formData.get('credentialId'))
  if (Number.isInteger(id)) {
    db.delete(schema.siteCredentials).where(eq(schema.siteCredentials.id, id)).run()
  }
  revalidatePath('/fixes')
  revalidatePath('/clients')
}

export async function applyFixAction(_prev: FixState, formData: FormData): Promise<FixState> {
  const recommendationId = Number(formData.get('recommendationId'))
  if (!Number.isInteger(recommendationId)) {
    return { error: 'No fix was given.', notice: null }
  }

  const rec = db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.id, recommendationId))
    .all()[0]
  if (!rec) return { error: 'That fix no longer exists. Re-run the recommendations step.', notice: null }

  if (rec.placeholderCount > 0) {
    return {
      error: 'This still has values only the business can confirm in it, so it cannot be published.',
      notice: null,
    }
  }

  const cred = credentialFor(rec.clientId)
  const editor = cred ? editorFor(cred) : null
  if (!cred || !editor) return { error: 'The website is not connected.', notice: null }

  const page = rec.pageId
    ? db.select().from(schema.pages).where(eq(schema.pages.id, rec.pageId)).all()[0]
    : undefined
  if (!page) return { error: 'This fix is not attached to a page read from the site.', notice: null }

  const request = {
    page: {
      id: page.id,
      externalId: page.externalId,
      url: page.url,
      slug: page.slug,
      pageType: page.pageType,
      title: page.title,
      metaDescription: page.metaDescription,
    },
    field: rec.kind as EditableField,
    currentValue: rec.currentValue,
    proposedValue: rec.proposedValue,
  }

  const refusal = editor.refuse(request)
  if (refusal) return { error: refusal, notice: null }

  let result
  try {
    result = await editor.apply(request)
  } catch (err) {
    result = {
      ok: false as const,
      previousValue: null,
      error: `The site could not be reached: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  db.insert(schema.fixApplications)
    .values({
      clientId: rec.clientId,
      recommendationId: rec.id,
      pageId: page.id,
      targetUrl: page.url,
      field: rec.kind,
      previousValue: result.previousValue,
      appliedValue: rec.proposedValue,
      status: result.ok ? 'applied' : 'failed',
      error: result.ok ? null : result.error,
    })
    .run()

  revalidatePath('/fixes')
  revalidatePath('/clients')
  return result.ok
    ? { error: null, notice: `Published to ${page.url}. ${result.detail}` }
    : { error: result.error, notice: null }
}

export async function revertFixAction(_prev: FixState, formData: FormData): Promise<FixState> {
  const applicationId = Number(formData.get('applicationId'))
  const application = db
    .select()
    .from(schema.fixApplications)
    .where(eq(schema.fixApplications.id, applicationId))
    .all()[0]
  if (!application) return { error: 'That change is not on record.', notice: null }

  if (application.previousValue === null) {
    return {
      error:
        'The value that was there before this change was not recorded, so it cannot be put back automatically.',
      notice: null,
    }
  }

  const cred = credentialFor(application.clientId)
  const editor = cred ? editorFor(cred) : null
  if (!cred || !editor) return { error: 'The website is not connected.', notice: null }

  const page = application.pageId
    ? db.select().from(schema.pages).where(eq(schema.pages.id, application.pageId)).all()[0]
    : undefined
  if (!page) return { error: 'The page this changed is no longer on record.', notice: null }

  // The revert is the same edit run backwards: what was published becomes the
  // text to find, and what was there before becomes the replacement.
  const result = await editor.apply({
    page: {
      id: page.id,
      externalId: page.externalId,
      url: page.url,
      slug: page.slug,
      pageType: page.pageType,
      title: page.title,
      metaDescription: page.metaDescription,
    },
    field: application.field as EditableField,
    currentValue: application.appliedValue,
    proposedValue: application.previousValue,
  })

  if (!result.ok) return { error: result.error, notice: null }

  db.update(schema.fixApplications)
    .set({ status: 'reverted' })
    .where(eq(schema.fixApplications.id, application.id))
    .run()

  revalidatePath('/fixes')
  return { error: null, notice: `Put back what was on ${page.url} before.` }
}
