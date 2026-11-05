/**
 * `@tiny-agents/agent/browser`: live browser sessions and the transports that
 * open them (local Chromium, or Chrome on the sandbox over CDP). The browser
 * toolkit the bots call stays on the package root.
 */
export {
  closeAllBrowserSessions,
  createBrowserSessions,
  type BrowserSessions,
  type BrowserSessionsOptions,
  type BrowserTarget,
  type BrowserTransport,
} from "../toolkits/browser-sessions";
export {
  createChromiumTransport,
  type ChromiumTransportOptions,
} from "../toolkits/browser-chromium";
export {
  createRemoteCdpTransport,
  type RemoteCdpTransportOptions,
} from "../toolkits/browser-remote-cdp";
