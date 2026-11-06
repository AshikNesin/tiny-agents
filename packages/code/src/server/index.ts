/**
 * `@tiny-agents/code/server`: the built-in harness drivers and the helpers
 * they share. The app builds instances from its config and hands them a
 * `HarnessHost`; nothing here imports the app.
 */
export * from "../contracts";
export { Emitter, excerpt, firstLine, isImageFile, pick, record } from "./items";
export { turnAnswer, turnOutcome, type TurnFacts } from "./outcome";
export {
  NO_PARTIAL,
  ThreadFeed,
  type PartialText,
  type StatePatch,
  type ThreadListener,
} from "./feed";
export {
  HarnessError,
  badGateway,
  badRequest,
  capabilityMissing,
  notFound,
  unavailable,
} from "./errors";
export * as shelley from "../drivers/shelley";
export { createShelleyHarness, type ShelleyHarness } from "../drivers/shelley";
export { createClaudeCodeHarness } from "../drivers/claude-code";
