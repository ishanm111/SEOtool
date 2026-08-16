import type { ChatEngineConfig } from './types'

/**
 * Selectors are listed most-specific first with generic fallbacks behind them.
 * These apps redesign often — when an engine breaks, add a new selector to the
 * front of the array rather than replacing the list.
 */

export const CHATGPT: ChatEngineConfig = {
  name: 'chatgpt',
  url: 'https://chatgpt.com/',
  inputSelectors: [
    '#prompt-textarea',
    '[data-testid="prompt-textarea"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea',
  ],
  answerSelectors: [
    '[data-message-author-role="assistant"]',
    'div[data-message-id] .markdown',
    '.markdown.prose',
    'article',
  ],
  submitSelectors: [
    '[data-testid="send-button"]',
    'button[aria-label*="Send" i]',
  ],
}

export const GEMINI: ChatEngineConfig = {
  name: 'gemini',
  url: 'https://gemini.google.com/app',
  inputSelectors: [
    'rich-textarea div[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    '.ql-editor',
    'div[contenteditable="true"]',
    'textarea',
  ],
  answerSelectors: [
    'model-response',
    'message-content',
    '.model-response-text',
    '.markdown',
  ],
  submitSelectors: [
    'button[aria-label*="Send" i]',
    '.send-button',
  ],
  dismissSelectors: [
    // Feature-tour / onboarding popups live in the CDK overlay container.
    '.cdk-overlay-container button[aria-label*="Close" i]',
    '.cdk-overlay-container button[aria-label*="Got it" i]',
    '.cdk-overlay-container button:has-text("Got it")',
    '.cdk-overlay-container button:has-text("No thanks")',
    'button:has-text("Not now")',
  ],
}

export const PERPLEXITY: ChatEngineConfig = {
  name: 'perplexity',
  url: 'https://www.perplexity.ai/',
  inputSelectors: [
    'textarea[placeholder*="Ask" i]',
    '#ask-input',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea',
  ],
  answerSelectors: [
    '[id^="markdown-content"]',
    'div[class*="prose"]',
    '.prose',
    'main',
  ],
  submitSelectors: [
    'button[aria-label*="Submit" i]',
    'button[data-testid="submit-button"]',
  ],
}

export const CHAT_ENGINES = [CHATGPT, GEMINI, PERPLEXITY]
