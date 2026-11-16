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
import { Button, Input, Label, metaLabelClass, monoClass } from "@groot/ui";
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

/** Post the manifest to GitHub as a form: GitHub shows the owner the App to create. */
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

/**
 * The optional GitHub App, created in one click (GitHub's App Manifest flow,
 * as FeedbackBee does): GitHub creates it with the right permissions and
 * events and hands back its key and webhook secret, which go to the vault.
 * Then one more click installs it on repositories.
 */
function GitHubAppForm({
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
      <form
        className="border-border space-y-2 rounded-xl border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void go("start the GitHub App setup", async () => {
            const { url, manifest } = await projectsApi.createApp(organization.trim() || undefined);
            submitManifest(url, manifest);
          });
        }}
      >
        <p className="text-sm">GitHub App (optional)</p>
        <p className="text-muted-foreground text-xs">
          Short-lived tokens instead of a stored token, pull requests opened by the App, and
          webhooks instead of polling. GitHub creates the App with the access Code needs; you only
          confirm it there.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            placeholder="Organization (leave empty for your account)"
            aria-label="Organization"
            className="min-w-56 flex-1"
          />
          <Button type="submit" size="sm" disabled={busy} data-testid="code-github-app">
            {busy ? <Spinner /> : <GitBranch />}
            Create GitHub App
          </Button>
        </div>
      </form>
    );
  }
  const app = status.app;
  return (
    <div className="border-border space-y-2 rounded-xl border p-3">
      <p className="text-sm">
        GitHub App <span className={monoClass}>{app.name}</span>
      </p>
      <p className="text-muted-foreground text-xs">
        {app.webhooks
          ? "GitHub sends its events here, so Code looks at a pull request within seconds."
          : "This server's address is not public https, so GitHub sends no webhooks; Code polls."}
      </p>
      <div className="flex flex-wrap gap-2">
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
    </div>
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
  const [bots, setBots] = useState(() => project.settings.autofix.trustedBots.join(", "));
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
  const [appRepos, setAppRepos] = useState<Array<{ fullName: string }> | null>(null);
  useEffect(() => {
    if (!viaApp) return;
    setRepo("");
    projectsApi
      .appRepositories()
      .then(setAppRepos)
      .catch((e: unknown) => {
        toast.error(errorMessage(e, "Could not list the App's repositories."));
        setAppRepos(null);
      });
  }, [viaApp]);
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
            {viaApp && appRepos ? (
              <select
                aria-label="Repository"
                className="border-input bg-background h-9 min-w-56 flex-1 rounded-lg border px-2 text-sm"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
              >
                <option value="">
                  {appRepos.length
                    ? "Pick a repository the App is installed on"
                    : "Install the App on a repository first"}
                </option>
                {appRepos.map((r) => (
                  <option key={r.fullName} value={r.fullName}>
                    {r.fullName}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/repository or its GitHub URL"
                aria-label="Repository"
                className="min-w-56 flex-1"
              />
            )}
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
