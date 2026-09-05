import Link from 'next/link'

/** Shown before the first client exists, so every screen fails into a next step. */
export function NoClient() {
  return (
    <div className="rounded-xl border border-dashed border-line-2 bg-card px-6 py-10 text-center">
      <h1 className="display text-2xl">No client is being viewed</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">
        Add a business by giving SEOmyze its website and its Google listing. It works out the
        platform, the services, the places served and the name variants the AI engines have to
        match.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Link href="/clients/new" className="btn btn-primary">
          Add a client
        </Link>
        <Link href="/clients" className="btn btn-secondary">
          See all clients
        </Link>
      </div>
    </div>
  )
}
