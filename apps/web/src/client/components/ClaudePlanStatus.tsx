import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@groot/ui/card";
import { Button, Text } from "@groot/ui";
import { claudeCodeApi, type ClaudeCodeAccount, type ClaudeCodeStatus } from "../lib/bots-api";
import { terminalApi } from "../lib/terminal-api";
import { errorMessage } from "../lib/errors";

/** While Claude Code installs on the sandbox, check again this often. */
const INSTALL_POLL_MS = 3000;

function accountLine(account: ClaudeCodeAccount | undefined): string {
  if (!account) return "Checking Claude Code on the sandbox.";
  switch (account.state) {
    case "unconfigured":
      return "No sandbox is configured. Set SANDBOX_HOST, or run pnpm sandbox:up for a local one.";
    case "installing":
      return "Installing Claude Code on the sandbox. This takes a minute or two, once.";
    case "error":
      return account.detail;
    case "ready":
      return account.subscription
        ? `Signed in to Claude${account.plan ? ` (${account.plan})` : ""}. Ready to use.`
        : "Claude Code is installed but not signed in to a Claude subscription.";
  }
}

function engineLine(status: ClaudeCodeStatus | undefined): string {
  if (!status) return "Checking the Claude plan engine.";
  return status.enabled
    ? "The engine is on. Bots on a “uses your Claude plan” model answer through Claude Code."
    : "The engine is off. Add or enable the Claude plan account in Settings → Models to turn it on.";
}

function fallbackLine(status: ClaudeCodeStatus): string {
  const host = status.workerHost ? `Worker on ${status.workerHost}. ` : "";
  const then = status.fallback === "gateway" ? "move to its fallback model" : "pause";
  return `${host}When the engine is off or Claude Code can't answer, turns ${then}.`;
}

/** The engine's switch and worker mode, read once. */
function useClaudeStatus() {
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
        if (!cancelled) setError(errorMessage(caught, "Status unavailable"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, error };
}

/** The login state, re-read while Claude Code is still installing. */
function useClaudeAccount() {
  const [account, setAccount] = useState<ClaudeCodeAccount | undefined>();

  const check = useCallback(async () => {
    try {
      setAccount(await claudeCodeApi.account());
    } catch (caught) {
      setAccount({ state: "error", detail: errorMessage(caught, "Could not reach the sandbox") });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    if (account?.state !== "installing") return;
    const timer = setTimeout(() => void check(), INSTALL_POLL_MS);
    return () => clearTimeout(timer);
  }, [account, check]);

  return { account, check };
}

/** Opens a terminal tab that runs `claude auth login`, then shows it. */
function useClaudeSignIn() {
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);

  const signIn = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      const tab = await terminalApi.create(undefined, "claude-login");
      navigate(`/terminal?tab=${encodeURIComponent(tab.name)}`);
    } catch (caught) {
      toast.error(errorMessage(caught, "Could not open a terminal on the sandbox"));
    } finally {
      setOpening(false);
    }
  }, [navigate, opening]);

  return { signIn, opening };
}

function AccountActions({
  account,
  onCheck,
}: {
  account: ClaudeCodeAccount | undefined;
  onCheck: () => void;
}) {
  const { signIn, opening } = useClaudeSignIn();
  const ready = account?.state === "ready";
  const signedIn = ready && account.subscription;
  return (
    <div className="flex flex-wrap gap-2">
      {ready ? (
        <Button
          size="sm"
          variant={signedIn ? "outline" : "default"}
          onClick={() => void signIn()}
          disabled={opening}
          data-testid="claude-plan-sign-in"
        >
          {signedIn ? "Sign in again" : "Sign in to Claude"}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={onCheck}>
        Check again
      </Button>
    </div>
  );
}

/**
 * Settings card for the Claude plan engine. The app sets Claude Code up on
 * the sandbox by itself; the one step left to the owner is the login, which
 * runs in Claude Code's own prompt in a terminal tab. There is no field for
 * a Claude credential: Claude Code keeps the login on the sandbox.
 */
export function ClaudePlanStatusCard() {
  const { status, error } = useClaudeStatus();
  const { account, check } = useClaudeAccount();
  const onSandbox = status?.mode === "sandbox" || account?.state === "ready";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claude plan</CardTitle>
        <CardDescription>
          Experimental. Bots can answer on your Claude Pro or Max subscription through Claude Code,
          which tiny-agents installs and runs on your sandbox. tiny-agents never sees the login.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p>
          <Text>{error ?? engineLine(status)}</Text>
        </p>
        {/* With the engine off there is no worker, so the account check reports
            "unconfigured" even when a sandbox is set up: saying "No sandbox is
            configured" then is wrong (#171). The line only means something with
            the engine on. */}
        {status?.enabled === false ? null : (
          <p>
            <Text data-testid="claude-plan-account">{accountLine(account)}</Text>
          </p>
        )}
        {onSandbox ? <AccountActions account={account} onCheck={() => void check()} /> : null}
        {status ? (
          <p>
            <Text variant="meta">{fallbackLine(status)}</Text>
          </p>
        ) : null}
        <p>
          <Text variant="meta">
            Sign in opens a terminal tab running claude auth login: follow its link, then paste the
            code back into the tab. Never paste a Claude token into tiny-agents.
          </Text>
        </p>
      </CardContent>
    </Card>
  );
}
