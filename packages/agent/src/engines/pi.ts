import type { Harness } from "@earendil-works/pi-durable";
import type { AgentEngine } from "../engine";

/**
 * The pi-durable harness as an engine. Owning the harness here is the seam
 * the Claude Code engine sits beside. Every call still goes to the same
 * harness methods the runtime used directly.
 */
export class PiEngine implements AgentEngine {
  readonly kind = "pi" as const;

  constructor(readonly harness: Harness) {}
}
