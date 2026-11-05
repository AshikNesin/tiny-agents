/**
 * `@tiny-agents/agent/computer`: live desktop sessions and the X11 transport
 * that runs them on the sandbox VM (ADR 0006). The computer toolkit the bots
 * call stays on the package root.
 */
export {
  closeAllComputerSessions,
  createComputerSessions,
  type ComputerSessions,
  type ComputerSessionsOptions,
  type ComputerTransport,
} from "../toolkits/computer-sessions";
export {
  createX11ComputerTransport,
  type X11ComputerTransportOptions,
} from "../toolkits/computer-x11";
export { parseDesktopSize, parseExtraPackages } from "../toolkits/computer-vm-setup";
