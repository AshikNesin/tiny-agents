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
