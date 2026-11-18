/**
 * A deferred toolkit with its tools already loaded, as after the model's
 * `tool_search`: for tests of what a tool does once called, not of loading.
 */
import type { Capability } from "../../../packages/agent/src/capabilities";

export function loaded(capability: Capability): Capability {
  const tools = capability.extension.tools?.map(({ deferred: _deferred, ...tool }) => tool);
  return { ...capability, extension: { ...capability.extension, ...(tools ? { tools } : {}) } };
}
