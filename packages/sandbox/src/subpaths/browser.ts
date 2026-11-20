/**
 * `@tiny-agents/sandbox/browser`: live browser sessions and the transports
 * that open them (local Chromium, or Chrome on the sandbox over CDP), with
 * the URL and ref guards and the secret-fill types their sinks use. The
 * browser toolkit the bots call stays in `@tiny-agents/agent`.
 */
export {
  closeAllBrowserSessions,
  conversationBrowserTarget,
  createBrowserSessions,
  DEFAULT_BROWSER_PROFILES_DIR,
  describeBrowserError,
  type BrowserDriver,
  type BrowserSession,
  type BrowserSessions,
  type BrowserSessionsOptions,
  type BrowserTarget,
  type BrowserTransport,
  type BrowserVnc,
  type LiveBrowserTab,
} from "../browser-sessions";
export { createChromiumTransport, type ChromiumTransportOptions } from "../browser-chromium";
export { createRemoteCdpTransport, type RemoteCdpTransportOptions } from "../browser-remote-cdp";
export {
  assertRefShape,
  checkNavigableUrl,
  isBlockedPrivateUrl,
  parseExemptHosts,
} from "../browser-guard";
export { filterSnapshot, pageWindow, snapshotDiff } from "../browser-snapshot";
export { FrameOriginError, type SecretFill, type SecretFillField } from "../browser-fill";
