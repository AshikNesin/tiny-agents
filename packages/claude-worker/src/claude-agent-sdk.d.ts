/**
 * Types for the optional Agent SDK. The package is installed on the worker
 * VM only. `bin.ts` loads it with `import()` and exits if it is missing, so
 * CI typechecks without the dependency and never calls Anthropic.
 */
declare module "@anthropic-ai/claude-agent-sdk" {
  export const query: import("./sdk").ClaudeSdkModule["query"];
  export const tool: import("./sdk").ClaudeSdkModule["tool"];
  export const createSdkMcpServer: import("./sdk").ClaudeSdkModule["createSdkMcpServer"];
  export const getSessionMessages: import("./coding-sdk").CodingSdk["getSessionMessages"];
  export const forkSession: import("./coding-sdk").CodingSdk["forkSession"];
}
