import { redirect } from 'next/navigation'
import { currentPortalSession } from '@/portal/auth'
import { SignInForm } from './form'

export const dynamic = 'force-dynamic'

/**
 * The only page in the portal outside the gate.
 *
 * It lives beside the `(app)` group rather than inside it, so the layout that
 * redirects signed-out visitors never runs here — otherwise signing in would
 * bounce between this page and itself.
 */
export default async function PortalLogin() {
  if (await currentPortalSession()) redirect('/portal')

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-6">
        <div className="eyebrow">SEOmyze</div>
        <h1 className="display mt-1 text-3xl text-pine-deep">Sign in</h1>
        <p className="mt-2 text-sm text-ink-3">
          Use the email and password your contact gave you.
        </p>
      </div>
      <SignInForm />
    </div>
  )
}
