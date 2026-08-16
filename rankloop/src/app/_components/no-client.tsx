/** Shown when the database has no clients yet, so every page fails gracefully. */
export function NoClient() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
      <h1 className="text-lg font-semibold text-amber-900">No clients yet</h1>
      <p className="mt-2 text-sm text-amber-800">
        Add one by pointing the tool at a website:
      </p>
      <code className="mt-3 block rounded bg-amber-100 px-3 py-2 text-xs text-amber-900">
        npx tsx src/scripts/add-client.ts https://example.com
      </code>
    </div>
  )
}
