import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@groot/ui/card";
import { Text } from "@groot/ui";
import { claudeCodeApi, type ClaudeCodeStatus } from "../lib/bots-api";

/**
 * Settings card for the Claude plan engine. It reports the kill switch and
 * whether a worker is configured. There is no field for a Claude credential:
 * Claude Code on the worker VM owns the login.
 */
export function ClaudePlanStatusCard() {
  const [status, setStatus] = useState<ClaudeCodeStatus | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    claudeCodeApi
      .status()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Status unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summary = !status
    ? "Checking the Claude plan engine."
    : status.enabled
      ? "The engine is on. Turns go to your Claude Code worker."
      : "The engine is off. CLAUDE_CODE_ENGINE_ENABLED is not set, so turns do not leave this app.";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claude plan</CardTitle>
        <CardDescription>
          Experimental. Uses the Claude subscription on your worker VM. tiny-agents never sees that
          login.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Text>{error ?? summary}</Text>
        {status ? (
          <Text variant="meta">
            {status.configured
              ? `Worker host ${status.workerHost ?? "configured"}.`
              : "No worker URL configured."}{" "}
            When the engine is off or the worker is down, turns{" "}
            {status.fallback === "gateway" ? "fall back to the AI gateway" : "pause"}.
          </Text>
        ) : null}
        <Text variant="meta">
          Log in on the worker with claude auth login or claude setup-token. Do not paste a Claude
          token here.
        </Text>
      </CardContent>
    </Card>
  );
}
