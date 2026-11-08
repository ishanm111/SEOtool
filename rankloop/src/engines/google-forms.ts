/**
 * Google Forms — turning the client questionnaire into something a business
 * owner can actually fill in.
 *
 * The questionnaire is the slowest part of onboarding. It is a conversation an
 * operator has to have, and the answers are the only thing standing between a
 * list of blocked recommendations and a publishable one. A form the client can
 * do in their own time, on their phone, between jobs, is worth more than a
 * perfectly worded question nobody ever gets asked.
 *
 * Plain fetch against the REST endpoints, matching search-console.ts — the
 * whole surface used here is four requests, and an SDK would be a dependency
 * for no gain.
 *
 * Two scopes, and both are needed:
 *   forms.body  — create the form and write its questions
 *   drive.file  — share it, limited to files this app itself created
 *
 * Without the Drive scope the form is created private to the operator's own
 * Google account and the responder link asks a client to sign in and then
 * refuses them, which looks exactly like a broken link.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FORMS_API = 'https://forms.googleapis.com/v1/forms'
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'

export const SCOPES = [
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/drive.file',
].join(' ')

/** Google's own value for the installed-app / manual-copy flow. */
export const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'

export type FormItem =
  | { kind: 'header'; title: string; description?: string }
  | {
      kind: 'question'
      title: string
      description?: string
      /** A one-line box, a paragraph box, or a fixed set of choices. */
      type: 'short' | 'paragraph' | 'choice'
      options?: string[]
    }

export type CreatedForm = {
  formId: string
  /** The link to send a client. */
  responderUri: string
  /** The link an operator opens to edit the questions or read the answers. */
  editUri: string
  /** False when the form was made but could not be shared; it still exists. */
  shared: boolean
  shareError?: string
}

function credentials() {
  // Falls back to the Search Console client on purpose: it is the same Google
  // Cloud project and the same desktop OAuth client, and asking an operator to
  // create a second identical one is a step that earns nothing.
  const clientId = process.env.GOOGLE_CLIENT_ID ?? process.env.GSC_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? process.env.GSC_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in .env.local.\n' +
        'Create an OAuth client (type: Desktop app) at console.cloud.google.com, enable the\n' +
        'Google Forms API and the Google Drive API, then run:\n' +
        '  npm run forms-auth',
    )
  }
  return { clientId, clientSecret }
}

export function authUrl(): string {
  const { clientId } = credentials()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    // Without this, a second authorisation returns no refresh token at all.
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeCode(code: string): Promise<string> {
  const { clientId, clientSecret } = credentials()
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: code.trim(),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  const json = (await res.json()) as {
    refresh_token?: string
    error_description?: string
    error?: string
  }
  if (!res.ok || !json.refresh_token) {
    throw new Error(`token exchange failed: ${json.error_description ?? json.error ?? res.status}`)
  }
  return json.refresh_token
}

async function accessToken(): Promise<string> {
  const { clientId, clientSecret } = credentials()
  const refresh = process.env.GOOGLE_FORMS_REFRESH_TOKEN
  if (!refresh) {
    throw new Error(
      'GOOGLE_FORMS_REFRESH_TOKEN is not set. Run:  npm run forms-auth',
    )
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  })
  const json = (await res.json()) as {
    access_token?: string
    error_description?: string
    error?: string
  }
  if (!res.ok || !json.access_token) {
    throw new Error(`could not refresh token: ${json.error_description ?? json.error ?? res.status}`)
  }
  return json.access_token
}

/** One Forms API request object for an item, or null for an unsupported kind. */
function requestFor(item: FormItem, index: number) {
  if (item.kind === 'header') {
    return {
      createItem: {
        item: {
          title: item.title,
          ...(item.description ? { description: item.description } : {}),
          textItem: {},
        },
        location: { index },
      },
    }
  }

  const question =
    item.type === 'choice'
      ? {
          choiceQuestion: {
            type: 'RADIO',
            options: (item.options ?? []).map((value) => ({ value })),
          },
        }
      : { textQuestion: { paragraph: item.type === 'paragraph' } }

  return {
    createItem: {
      item: {
        title: item.title,
        ...(item.description ? { description: item.description } : {}),
        // Every question is optional, exactly as in the console: a half-filled
        // questionnaire is strictly better than an abandoned one.
        questionItem: { question: { required: false, ...question } },
      },
      location: { index },
    },
  }
}

async function call(url: string, token: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    const message =
      (body as { error?: { message?: string } })?.error?.message ?? `${res.status} ${res.statusText}`
    throw new Error(message)
  }
  return body
}

/**
 * Creates a form, fills it in, and shares it so anyone with the link can answer.
 *
 * Three calls, in this order, because the API requires it: a form can only be
 * created with a title, so the questions go in afterwards as a batchUpdate.
 *
 * Sharing is the one step allowed to fail without failing the whole thing. A
 * form that exists but is private is recoverable in two clicks; throwing here
 * would leave an orphaned form behind and tell the operator nothing was made.
 */
export async function createForm(
  title: string,
  description: string,
  items: FormItem[],
): Promise<CreatedForm> {
  const token = await accessToken()

  const created = (await call(FORMS_API, token, {
    method: 'POST',
    // documentTitle is the Drive filename; title is what a respondent reads.
    body: JSON.stringify({ info: { title, documentTitle: title } }),
  })) as { formId?: string; responderUri?: string }

  const formId = created.formId
  if (!formId) throw new Error('Google created no form id')

  await call(`${FORMS_API}/${formId}:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        { updateFormInfo: { info: { description }, updateMask: 'description' } },
        ...items.map((item, i) => requestFor(item, i)),
      ],
    }),
  })

  let shared = true
  let shareError: string | undefined
  try {
    await call(`${DRIVE_API}/${formId}/permissions`, token, {
      method: 'POST',
      body: JSON.stringify({ type: 'anyone', role: 'reader' }),
    })
  } catch (err) {
    shared = false
    shareError = err instanceof Error ? err.message : String(err)
  }

  return {
    formId,
    responderUri: created.responderUri ?? `https://docs.google.com/forms/d/${formId}/viewform`,
    editUri: `https://docs.google.com/forms/d/${formId}/edit`,
    shared,
    shareError,
  }
}

/** Whether a form can be created at all, for an interface that must say why not. */
export function formsConfigured(): { ok: boolean; reason?: string } {
  try {
    credentials()
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
  if (!process.env.GOOGLE_FORMS_REFRESH_TOKEN) {
    return { ok: false, reason: 'GOOGLE_FORMS_REFRESH_TOKEN is not set. Run:  npm run forms-auth' }
  }
  return { ok: true }
}
