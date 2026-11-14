/**
 * `@tiny-agents/sandbox/computer`: live desktop sessions and the X11
 * transport that runs them on the sandbox VM (ADR 0006). The computer
 * toolkit the bots call stays in `@tiny-agents/agent`.
 */
export {
  closeAllComputerSessions,
  createComputerSessions,
  DesktopGoneError,
  OwnerDrivingError,
  takeoverOf,
  type ComputerSessions,
  type ComputerSessionsOptions,
  type ComputerTransport,
  type KeyModifier,
  type LiveComputer,
} from "../computer-sessions";
export { createX11ComputerTransport, type X11ComputerTransportOptions } from "../computer-x11";
export { parseDesktopSize, parseExtraPackages } from "../computer-vm-setup";
