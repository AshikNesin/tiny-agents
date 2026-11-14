/**
 * `@tiny-agents/agent/browser`: moved to `@tiny-agents/sandbox/browser`
 * (rewrite step 3.4). Re-exported so importers of this subpath keep
 * compiling; nothing in this repo imports them from here. The browser
 * toolkit the bots call stays on the package root.
 */
export {
  /** @deprecated Import from `@tiny-agents/sandbox/browser`. */
  closeAllBrowserSessions,
  /** @deprecated Import from `@tiny-agents/sandbox/browser`. */
  createBrowserSessions,
  /** @deprecated Import from `@tiny-agents/sandbox/browser`. */
  createChromiumTransport,
  /** @deprecated Import from `@tiny-agents/sandbox/browser`. */
  createRemoteCdpTransport,
  /** @deprecated Import from `@tiny-agents/sandbox/browser`. */
  DEFAULT_BROWSER_PROFILES_DIR,
} from "@tiny-agents/sandbox/browser";
export type {
  /** @deprecated Import from `@tiny-agents/sandbox/browser`. */
  BrowserSessions,
  /** @deprecated Import from `@tiny-agents/sandbox/browser`. */
  BrowserSessionsOptions,
  /** @deprecated Import from `@tiny-agents/sandbox/browser`. */
  BrowserTarget,
  /** @deprecated Import from `@tiny-agents/sandbox/browser`. */
  BrowserTransport,
  /** @deprecated Import from `@tiny-agents/sandbox/browser`. */
  ChromiumTransportOptions,
  /** @deprecated Import from `@tiny-agents/sandbox/browser`. */
  RemoteCdpTransportOptions,
} from "@tiny-agents/sandbox/browser";
