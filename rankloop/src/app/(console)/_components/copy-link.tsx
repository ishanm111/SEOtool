'use client'

import { useState } from 'react'

/**
 * Copying a link out of the console.
 *
 * Shared by the two panels that hand an operator a URL, because both of them
 * are copied into a text message far more often than they are clicked, and
 * each having its own button is how one of them ends up without the failure
 * case below.
 */
export function CopyLink({ url, label = 'Copy link' }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {
          // Clipboard access is refused in some browsers and over plain http on
          // anything but localhost. The link is on screen either way.
          setCopied(false)
        }
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}
