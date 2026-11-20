import type { Capability } from "../../../packages/agent/src/capabilities";

export function loaded(capability: Capability): Capability {
  const tools = capability.extension.tools?.map(({ deferred: _deferred, ...tool }) => tool);
  return { ...capability, extension: { ...capability.extension, ...(tools ? { tools } : {}) } };
}
