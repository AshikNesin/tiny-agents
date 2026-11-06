/**
 * Types for the optional Agent SDK. The package is installed on the worker
 * VM only. `bin.ts` loads it with `import()` and exits if it is missing, so
 * CI typechecks without the dependency and never calls Anthropic.
 *
 * `query()` is one function: the bot engine calls it locked down, the coding
 * mode with Claude Code's own tools. Older SDKs lack the session helpers,
 * which leaves the coding mode off.
 */
declare module "@anthropic-ai/claude-agent-sdk" {
  export const query: import("./sdk").ClaudeSdkModule["query"] &
    import("./coding-sdk").CodingSdk["query"];
  export const tool: import("./sdk").ClaudeSdkModule["tool"];
  export const createSdkMcpServer: import("./sdk").ClaudeSdkModule["createSdkMcpServer"];
  export const getSessionMessages:
    | import("./coding-sdk").CodingSdk["getSessionMessages"]
    | undefined;
  export const forkSession: import("./coding-sdk").CodingSdk["forkSession"] | undefined;
}
