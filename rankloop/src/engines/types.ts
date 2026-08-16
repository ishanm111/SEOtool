export type EngineName = 'chatgpt' | 'gemini' | 'perplexity' | 'google_aio'

export type EngineResult = {
  engine: EngineName
  answerText: string
  citations: { url: string; position: number }[]
  screenshotPath?: string
  raw?: unknown
  ok: boolean
  error?: string
}

export type ChatEngineConfig = {
  name: EngineName
  url: string
  /** Tried in order until one is found and is editable. */
  inputSelectors: string[]
  /** Tried in order; first selector that yields text wins. Last match is the answer. */
  answerSelectors: string[]
  /** Selector scoped to the answer for citation links. Falls back to answer container. */
  citationSelectors?: string[]
  /** Some engines need a click on a send button rather than Enter. */
  submitSelectors?: string[]
  /** Popups/overlays to dismiss before typing (cookie banners, feature tours). */
  dismissSelectors?: string[]
}
