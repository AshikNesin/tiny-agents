/**
 * Projects and GitHub for Code (issue #297 §6, §7.2), owner-only: which
 * credential reaches GitHub (a token kept in the vault, or `gh auth login`
 * on the sandbox) and whom it acts as; the projects, each a GitHub
 * repository with its checkout on the sandbox; and the per-project rules
 * threads and Auto-fix follow.
 */
import { useEffect, useState } from "react";
import { FolderGit2, GitBranch, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Label, Textarea, metaLabelClass, monoClass } from "@groot/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { useConfirm } from "@groot/ui/primitives";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { Switch } from "../../components/ui/switch";
import { errorMessage } from "../../lib/errors";
import { projectsApi } from "../../lib/code/projects";
import type { HarnessInfo } from "../../lib/code/api";
import type { GitHubStatus, ProjectUpdateBody, ProjectView } from "../../../shared/api/code";

function GitHubSection() {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    projectsApi
      .github()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
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
  return (
    <section className="space-y-2" aria-label="GitHub">
      <h3 className={cn(metaLabelClass, "flex items-center gap-1.5")}>
        <GitBranch className="size-3.5" />
        GitHub
      </h3>
      {!status ? (
        <Spinner />
      ) : (
        <div className="space-y-2 text-sm">
          <p>
            {status.credential === "token"
              ? "A token from the vault: API calls go from this server; only git push runs on the sandbox."
              : "gh on the sandbox, signed in with gh auth login from the Terminal page. Every process on the sandbox can use that login."}
          </p>
          <p className="text-muted-foreground text-xs">
            {status.login ? `Acts as ${status.login}.` : (status.error ?? "Not signed in.")}
            {status.tools &&
              ` Sandbox: git ${status.tools.git ? "found" : "missing"}, gh ${status.tools.gh ? "found" : "missing"}.`}
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (token.trim()) void save(token.trim());
            }}
          >
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
          </form>
          {status.credential === "token" && (
            <Button variant="ghost" size="sm" onClick={() => void save(null)} disabled={busy}>
              Remove the token and use gh on the sandbox
            </Button>
          )}
          <GitHubAppForm status={status} onSaved={setStatus} />
        </div>
      )}
    </section>
  );
}

/**
 * The optional GitHub App (phase 6): API calls with short-lived
 * installation tokens and webhooks for events, for projects that choose it.
 * Its key and webhook secret are kept as `app` vault items.
 */
function GitHubAppForm({
  status,
  onSaved,
}: {
  status: GitHubStatus;
  onSaved(status: GitHubStatus): void;
}) {
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (
    value: { appId: string; privateKey: string; webhookSecret: string } | null,
  ) => {
    setBusy(true);
    try {
      onSaved(await projectsApi.setApp(value));
      setOpen(false);
      setPrivateKey("");
      setWebhookSecret("");
    } catch (e) {
      toast.error(errorMessage(e, "Could not save the GitHub App."));
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground text-xs">
          {status.appId
            ? `GitHub App ${status.appId} is set up. Its webhook URL is ${window.location.origin}/api/v1/code/github/webhook.`
            : "Optional: a GitHub App gives projects short-lived tokens and webhooks instead of polling."}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          data-testid="code-github-app"
        >
          {status.appId ? "Replace the App" : "Set up a GitHub App"}
        </Button>
        {status.appId && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save(null)}>
            Remove the App
          </Button>
        )}
      </div>
    );
  }
  return (
    <form
      className="border-border space-y-2 rounded-xl border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save({ appId: appId.trim(), privateKey: privateKey.trim(), webhookSecret });
      }}
    >
      <p className="text-muted-foreground text-xs">
        Create the App on GitHub with read and write access to contents, pull requests and checks,
        subscribe it to pull request, review, review comment, check run, check suite, status and
        issue comment events, and point its webhook at{" "}
        <span className={monoClass}>{window.location.origin}/api/v1/code/github/webhook</span>.
      </p>
      <Input
        value={appId}
        onChange={(e) => setAppId(e.target.value)}
        placeholder="App ID"
        aria-label="App ID"
        inputMode="numeric"
      />
      <Textarea
        value={privateKey}
        onChange={(e) => setPrivateKey(e.target.value)}
        placeholder="-----BEGIN RSA PRIVATE KEY-----"
        aria-label="Private key"
        rows={4}
        className={monoClass}
      />
      <Input
        type="password"
        value={webhookSecret}
        onChange={(e) => setWebhookSecret(e.target.value)}
        placeholder="Webhook secret (16 characters or more)"
        aria-label="Webhook secret"
        autoComplete="off"
      />
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={
            busy ||
            !/^\d+$/.test(appId.trim()) ||
            !privateKey.includes("PRIVATE KEY") ||
            webhookSecret.length < 16
          }
        >
          Save the App
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ProjectRow({
  project,
  harnesses,
  onChange,
}: {
  project: ProjectView;
  harnesses: HarnessInfo[];
  onChange(): void;
}) {
  const confirm = useConfirm();
  const [bots, setBots] = useState(project.settings.autofix.trustedBots.join(", "));
  const [check, setCheck] = useState(project.settings.scripts.check ?? "");
  const update = (body: ProjectUpdateBody) =>
    void projectsApi
      .update(project.id, body)
      .then(onChange)
      .catch((e: unknown) => toast.error(errorMessage(e, "Could not save that.")));
  const remove = async () => {
    const ok = await confirm({
      title: `Remove ${project.name}?`,
      description: "Its threads keep working without a project. The checkout stays on the sandbox.",
      destructive: true,
      confirmLabel: "Remove",
    });
    if (ok) {
      await projectsApi
        .remove(project.id)
        .catch((e: unknown) => toast.error(errorMessage(e, "Could not remove it.")));
      onChange();
    }
  };
  return (
    <li className="border-border space-y-3 rounded-xl border p-3" data-testid="code-project">
      <div className="flex items-center gap-2">
        <FolderGit2 className="text-muted-foreground size-4" />
        <span className="font-medium">{project.name}</span>
        <span className={cn("text-muted-foreground truncate text-xs", monoClass)}>
          {project.repo.owner}/{project.repo.name} · {project.baseBranch}
          {project.transport === "app" ? " · GitHub App" : ""}
        </span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${project.name}`}
          onClick={() => void remove()}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <label className="flex items-center gap-2">
          <Switch
            checked={project.settings.archiveOnMerge}
            onCheckedChange={(v) => update({ settings: { archiveOnMerge: v } })}
          />
          Archive the thread when its PR merges
        </label>
        <label className="flex items-center gap-2">
          <Switch
            checked={project.settings.autofix.onByDefault}
            onCheckedChange={(v) => update({ settings: { autofix: { onByDefault: v } } })}
          />
          Auto-fix new PRs
        </label>
        <label className="flex items-center gap-2">
          <Switch
            checked={project.settings.autofix.finalCheck}
            onCheckedChange={(v) => update({ settings: { autofix: { finalCheck: v } } })}
          />
          A final check when checks go green
        </label>
        <label className="flex items-center gap-2">
          <Switch
            checked={project.settings.autofix.triggers.mergeQueue}
            onCheckedChange={(v) =>
              update({ settings: { autofix: { triggers: { mergeQueue: v } } } })
            }
          />
          Fix when removed from the merge queue
        </label>
        <label className="flex items-center gap-2">
          <Switch
            checked={project.settings.autofix.autoMergeByDefault}
            onCheckedChange={(v) => update({ settings: { autofix: { autoMergeByDefault: v } } })}
          />
          Auto-merge new PRs
        </label>
        <div className="space-y-1">
          <Label htmlFor={`harness-${project.id}`}>Default harness</Label>
          <select
            id={`harness-${project.id}`}
            className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm"
            value={project.defaultInstanceId ?? ""}
            onChange={(e) => update({ defaultInstanceId: e.target.value || null })}
          >
            <option value="">Pick at start</option>
            {harnesses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`check-${project.id}`}>Check script</Label>
          <Input
            id={`check-${project.id}`}
            value={check}
            onChange={(e) => setCheck(e.target.value)}
            onBlur={() =>
              check !== (project.settings.scripts.check ?? "") &&
              update({ settings: { scripts: { check } } })
            }
            placeholder="From .tiny-agents/code.json"
            className={monoClass}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`bots-${project.id}`}>Trusted review bots</Label>
          <Input
            id={`bots-${project.id}`}
            value={bots}
            onChange={(e) => setBots(e.target.value)}
            onBlur={() =>
              update({
                settings: {
                  autofix: {
                    trustedBots: bots
                      .split(",")
                      .map((b) => b.trim())
                      .filter(Boolean),
                  },
                },
              })
            }
            placeholder="coderabbitai[bot], copilot-pull-request-reviewer[bot]"
          />
          <p className="text-muted-foreground text-xs">
            Their review comments become instructions to the agent. Owners, members and
            collaborators always count; anyone else is shown but ignored.
          </p>
        </div>
      </div>
    </li>
  );
}

export function ProjectsDialog({
  open,
  onOpenChange,
  harnesses,
  projects,
  onChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  harnesses: HarnessInfo[];
  projects: ProjectView[] | null;
  onChange(): void;
}) {
  const [repo, setRepo] = useState("");
  const [instanceId, setInstanceId] = useState(harnesses[0]?.id ?? "");
  const [viaApp, setViaApp] = useState(false);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      await projectsApi.create({
        repo: repo.trim(),
        defaultInstanceId: instanceId || undefined,
        ...(viaApp ? { transport: "app" as const } : {}),
      });
      setRepo("");
      onChange();
      toast.success("Project ready: the repository is cloned on the sandbox.");
    } catch (e) {
      toast.error(errorMessage(e, "Could not create the project."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Projects</DialogTitle>
          <DialogDescription>
            A project is a GitHub repository checked out on the sandbox. Each thread started in it
            gets its own worktree and branch, and can publish a pull request.
          </DialogDescription>
        </DialogHeader>
        <GitHubSection />
        <section className="space-y-2" aria-label="New project">
          <h3 className={metaLabelClass}>New project</h3>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (repo.trim()) void create();
            }}
          >
            <Input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/repository or its GitHub URL"
              aria-label="Repository"
              className="min-w-56 flex-1"
            />
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={viaApp}
                onCheckedChange={setViaApp}
                aria-label="Use the GitHub App"
              />
              GitHub App
            </label>
            {harnesses.length > 1 && (
              <select
                aria-label="Default harness"
                className="border-input bg-background h-9 rounded-lg border px-2 text-sm"
                value={instanceId}
                onChange={(e) => setInstanceId(e.target.value)}
              >
                {harnesses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label}
                  </option>
                ))}
              </select>
            )}
            <Button type="submit" disabled={busy || !repo.trim()} data-testid="code-project-create">
              {busy ? <Spinner /> : <Plus />}
              Add
            </Button>
          </form>
        </section>
        <section className="space-y-2" aria-label="Projects">
          {projects === null ? (
            <Spinner />
          ) : projects.length === 0 ? (
            <p className="text-muted-foreground text-sm">No projects yet.</p>
          ) : (
            <ul className="space-y-2">
              {projects.map((p) => (
                <ProjectRow key={p.id} project={p} harnesses={harnesses} onChange={onChange} />
              ))}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
