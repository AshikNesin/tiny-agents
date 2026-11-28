import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GitBranch } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, monoClass } from "@groot/ui";
import { useConfirm } from "@groot/ui/primitives";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { projectsApi } from "../../lib/code/projects";
import { useResource } from "../../queries/resource";
import type { GitHubStatus } from "../../../shared/api/code";
import { SettingsGroup } from "./SettingsRows";

const GITHUB_KEY = ["code", "github", "status"];

export function useGitHubStatus() {
  const read = useResource<GitHubStatus | null>(GITHUB_KEY, () => projectsApi.github(), "");
  const client = useQueryClient();
  const setStatus = useCallback(
    (next: GitHubStatus) => client.setQueryData<GitHubStatus | null>(GITHUB_KEY, next),
    [client],
  );
  const status =
    read.status === "ready" ? read.data : read.status === "failed" ? (read.last ?? null) : null;
  return { status, setStatus };
}

export function GitHubSettings() {
  const { status, setStatus } = useGitHubStatus();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (value: string | null) => {
    setBusy(true);
    try {
      setStatus(await projectsApi.setToken(value));
      setToken("");
    } catch (e) {
      toast.error(errorMessage(e, "Could not save the token."));
    } finally {
      setBusy(false);
    }
  };
  if (!status) {
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  }
  return (
    <>
      <div className="space-y-1 px-1">
        <p className="text-muted-foreground text-sm">
          {status.login ? `Acts as ${status.login}.` : (status.error ?? "Not signed in.")}
          {status.tools &&
            ` Sandbox: git ${status.tools.git ? "found" : "missing"}, gh ${status.tools.gh ? "found" : "missing"}.`}
        </p>
      </div>
      <SettingsGroup
        title="Credential"
        description={
          status.credential === "token"
            ? "A token from the vault: API calls go from this server; only git push runs on the sandbox."
            : "gh on the sandbox, signed in with gh auth login from the Terminal page. Every process on the sandbox can use that login."
        }
      >
        <form
          className="space-y-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (token.trim()) void save(token.trim());
          }}
        >
          <div className="flex gap-2">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Fine-grained token for the project's repositories"
              aria-label="GitHub token"
              autoComplete="off"
            />
            <Button type="submit" disabled={busy || token.trim().length < 10}>
              Save
            </Button>
          </div>
          {status.credential === "token" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void save(null)}
              disabled={busy}
            >
              Remove the token and use gh on the sandbox
            </Button>
          )}
        </form>
      </SettingsGroup>
      <GitHubApp status={status} onSaved={setStatus} />
    </>
  );
}

function submitManifest(url: string, manifest: object) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = url;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "manifest";
  input.value = JSON.stringify(manifest);
  form.append(input);
  document.body.append(form);
  form.submit();
}

function GitHubApp({
  status,
  onSaved,
}: {
  status: GitHubStatus;
  onSaved(status: GitHubStatus): void;
}) {
  const confirm = useConfirm();
  const [organization, setOrganization] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (what: string, work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      toast.error(errorMessage(e, `Could not ${what}.`));
    } finally {
      setBusy(false);
    }
  };
  if (!status.app) {
    return (
      <SettingsGroup
        title="GitHub App (optional)"
        description="Short-lived tokens instead of a stored token, pull requests opened by the App, and webhooks instead of polling. GitHub creates the App with the access Code needs; you only confirm it there."
      >
        <form
          className="flex flex-wrap gap-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void go("start the GitHub App setup", async () => {
              const { url, manifest } = await projectsApi.createApp(
                organization.trim() || undefined,
              );
              submitManifest(url, manifest);
            });
          }}
        >
          <Input
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            placeholder="Organization (leave empty for your account)"
            aria-label="Organization"
            className="min-w-56 flex-1"
          />
          <Button type="submit" disabled={busy} data-testid="code-github-app">
            {busy ? <Spinner /> : <GitBranch />}
            Create GitHub App
          </Button>
        </form>
      </SettingsGroup>
    );
  }
  const app = status.app;
  return (
    <SettingsGroup
      title="GitHub App"
      description={
        app.webhooks
          ? "GitHub sends its events here, so Code looks at a pull request within seconds."
          : "This server's address is not public https, so GitHub sends no webhooks; Code polls."
      }
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <span className={cn("min-w-0 flex-1 truncate text-sm", monoClass)}>{app.name}</span>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            void go("open the installation", async () => {
              window.location.assign((await projectsApi.installApp()).url);
            })
          }
          data-testid="code-github-install"
        >
          Install on repositories
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void go("disconnect the GitHub App", async () => {
              const ok = await confirm({
                title: `Disconnect ${app.name}?`,
                description:
                  "Projects on the App stop reaching GitHub until it is set up again. Delete the App itself on GitHub.",
                destructive: true,
                confirmLabel: "Disconnect",
              });
              if (ok) onSaved(await projectsApi.disconnectApp());
            })
          }
        >
          Disconnect
        </Button>
      </div>
    </SettingsGroup>
  );
}
