import { claudeCodeApi } from "../lib/bots-api";
import { useResource } from "./resource";

const INSTALL_POLL_MS = 3000;

export const useClaudeCodeStatus = () =>
  useResource(["claude-code", "status"], () => claudeCodeApi.status(), "Status unavailable");

export const useClaudeCodeAccount = () =>
  useResource(
    ["claude-code", "account"],
    () => claudeCodeApi.account(),
    "Could not reach the sandbox",
    {
      refetchInterval: (query) =>
        query.state.status !== "error" && query.state.data?.state === "installing"
          ? INSTALL_POLL_MS
          : false,
    },
  );
