import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, Input, monoClass, metaLabelClass } from "@groot/ui";
import { useConfirm } from "@groot/ui/primitives";
import { Textarea } from "@groot/ui/textarea";
import { cn } from "@groot/ui/lib/utils";
import { SearchSelect } from "@groot/ui/search-select";
import { Spinner } from "../../components/ui/spinner";
import { Switch } from "@groot/ui/switch";
import { errorMessage } from "../../lib/errors";
import { projectsApi, reviewsApi, useProjects } from "../../lib/code/projects";
import { useCodeStore } from "../../store/code";
import { RESOURCE_QUERY, useResource } from "../../queries/resource";
import type { HarnessInfo, ModelOption } from "../../lib/code/api";
import { useViewerRole } from "../../store/people";
import type {
  GitHubStatus,
  ProjectUpdateBody,
  ProjectView,
  ReviewInboxSettings,
} from "../../../shared/api/code";
import { loadModels } from "./controls";
import { INBOX_SETTINGS_KEY } from "./ReviewList";

function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <div className="space-y-0.5 px-1">
        <h2 className={metaLabelClass}>{title}</h2>
        {description && <p className="text-muted-foreground text-xs">{description}</p>}
      </div>
      <div className="border-border divide-border divide-y rounded-xl border">{children}</div>
    </section>
  );
}

function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  stack = false,
}: {
  label: string;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  stack?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-x-6 gap-y-2 px-4 py-3",
        stack ? "flex-col" : "flex-col sm:flex-row sm:items-center",
      )}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </label>
        ) : (
          <p className="text-sm font-medium">{label}</p>
        )}
        {description && <p className="text-muted-foreground text-xs">{description}</p>}
      </div>
      <div className={cn("min-w-0", stack ? "w-full" : "shrink-0 sm:max-w-72")}>{children}</div>
    </div>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <SettingsRow label={label} description={description}>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </SettingsRow>
  );
}

interface TextFieldProps {
  id: string;
  value: string;
  onSave(next: string): false | void;
  placeholder?: string;
  mono?: boolean;
  required?: boolean;
  inputMode?: "numeric";
  className?: string;
}

function TextField(props: TextFieldProps) {
  return <DraftField key={props.value} {...props} />;
}

function DraftField({
  id,
  value,
  onSave,
  placeholder,
  mono,
  required,
  inputMode,
  className,
}: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (next === value) return;
    if ((required && !next) || onSave(next) === false) setDraft(value);
  };
  return (
    <Input
      id={id}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(value);
      }}
      placeholder={placeholder}
      inputMode={inputMode}
      autoComplete="off"
      className={cn("w-full sm:w-72", mono && monoClass, className)}
    />
  );
}

const list = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const projectSettingsPath = (id: string) =>
  `/settings/projects?project=${encodeURIComponent(id)}`;

export function LegacyCodeSettings() {
  const { section, projectId } = useParams();
  const { search } = useLocation();
  if (projectId) return <Navigate to={projectSettingsPath(projectId)} replace />;
  const target = section === "github" || section === "reviews" ? section : "projects";
  return <Navigate to={`/settings/${target}${search}`} replace />;
}

export function CodeSettingsSection({ section }: { section: "projects" | "github" | "reviews" }) {
  const [searchParams] = useSearchParams();
  const harnessList = useCodeStore((s) => s.harnesses);
  const statuses = useCodeStore((s) => s.statuses);
  const harnesses = useMemo(
    () => (harnessList ?? []).map((h) => ({ ...h, status: statuses[h.id] ?? h.status })),
    [harnessList, statuses],
  );
  const { projects, reload } = useProjects();
  return (
    <div className="space-y-8" data-testid="code-settings-page">
      <SettingsBody
        section={section}
        projectId={searchParams.get("project") ?? undefined}
        harnesses={harnesses}
        projects={projects}
        onChange={reload}
      />
    </div>
  );
}

function SettingsBody({
  section,
  projectId,
  harnesses,
  projects,
  onChange,
}: {
  section: string;
  projectId?: string;
  harnesses: HarnessInfo[];
  projects: ProjectView[] | null;
  onChange(): void;
}) {
  const role = useViewerRole();
  if (role === null) {
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  }
  if (role === "guest") {
    return (
      <EmptyState
        icon={FolderGit2}
        title="Projects are the owner's"
        description="Projects and GitHub are set up by the owner of this app."
      />
    );
  }
  if (section === "github") return <GitHubSettings />;
  if (section === "reviews") return <ReviewListSettings />;
  if (projects === null) {
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  }
  if (!projectId) {
    return <ProjectsSettings harnesses={harnesses} projects={projects} onChange={onChange} />;
  }
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    return (
      <EmptyState
        icon={FolderGit2}
        title="No such project"
        description={
          <Link to="/settings/projects" className="underline underline-offset-2">
            All projects
          </Link>
        }
      />
    );
  }
  return (
    <ProjectSettings key={project.id} project={project} harnesses={harnesses} onChange={onChange} />
  );
}

function ProjectsSettings({
  harnesses,
  projects,
  onChange,
}: {
  harnesses: HarnessInfo[];
  projects: ProjectView[];
  onChange(): void;
}) {
  return (
    <>
      <AddProject harnesses={harnesses} onChange={onChange} />
      {projects.length > 0 && (
        <SettingsGroup title="Your projects">
          <ul className="divide-border divide-y">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  to={projectSettingsPath(p.id)}
                  className="hover:bg-muted/60 flex items-center gap-3 px-4 py-3 outline-none first:rounded-t-xl last:rounded-b-xl focus-visible:ring-3 focus-visible:ring-ring/50"
                  data-testid="code-project"
                >
                  <FolderGit2 className="text-muted-foreground size-4 shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    <span className={cn("text-muted-foreground truncate text-xs", monoClass)}>
                      {p.repo.owner}/{p.repo.name} · {p.baseBranch}
                    </span>
                  </span>
                  <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </SettingsGroup>
      )}
    </>
  );
}

function AddProject({ harnesses, onChange }: { harnesses: HarnessInfo[]; onChange(): void }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const prefill = params.get("repo") ?? "";
  const github = useGitHubStatus().status;
  const [repo, setRepo] = useState(prefill);
  const [instanceId, setInstanceId] = useState(harnesses[0]?.id ?? "");
  const [viaApp, setViaApp] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasApp = Boolean(github?.app);
  useEffect(() => {
    if (hasApp) setViaApp(true);
  }, [hasApp]);
  useEffect(() => setRepo(prefill), [viaApp, prefill]);
  const appRepoQuery = useQuery({
    queryKey: ["code", "github", "app-repositories", prefill],
    queryFn: () => projectsApi.appRepositories(),
    enabled: viaApp,
    ...RESOURCE_QUERY,
  });
  const appRepos = appRepoQuery.isError ? null : (appRepoQuery.data ?? null);
  useEffect(() => {
    if (appRepoQuery.error) {
      toast.error(errorMessage(appRepoQuery.error, "Could not list the App's repositories."));
    }
  }, [appRepoQuery.error]);
  const create = async () => {
    setBusy(true);
    try {
      const created = await projectsApi.create({
        repo: repo.trim(),
        defaultInstanceId: instanceId || undefined,
        ...(viaApp ? { transport: "app" as const } : {}),
      });
      setRepo("");
      onChange();
      toast.success("Project ready: the repository is cloned on the sandbox.");
      navigate(projectSettingsPath(created.id));
    } catch (e) {
      toast.error(errorMessage(e, "Could not create the project."));
    } finally {
      setBusy(false);
    }
  };
  const harness = harnesses.find((h) => h.id === instanceId);
  return (
    <SettingsGroup title="Add a project">
      <form
        className="space-y-3 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (repo.trim()) void create();
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          {viaApp && appRepos ? (
            <SearchSelect
              label="Repository"
              value={repo}
              onValueChange={setRepo}
              options={appRepos.map((r) => ({ value: r.fullName, label: r.fullName }))}
              searchPlaceholder="Search repositories…"
              emptyText={
                appRepos.length
                  ? "No repository matches."
                  : "Install the App on a repository first."
              }
              triggerClassName="border-input h-9 min-w-56 flex-1 justify-between rounded-lg border px-3"
              contentClassName="w-(--anchor-width)"
            >
              <span className={cn("truncate", !repo && "text-muted-foreground")}>
                {repo ||
                  (appRepos.length
                    ? "Pick a repository the App is installed on"
                    : "Install the App on a repository first")}
              </span>
              <ChevronDown className="opacity-50" />
            </SearchSelect>
          ) : (
            <Input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/repository or its GitHub URL"
              aria-label="Repository"
              className="min-w-56 flex-1"
            />
          )}
          <Button type="submit" disabled={busy || !repo.trim()} data-testid="code-project-create">
            {busy ? <Spinner /> : <Plus />}
            Add
          </Button>
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          {github?.app && (
            <label className="flex items-center gap-2">
              <Switch
                checked={viaApp}
                onCheckedChange={setViaApp}
                aria-label="Use the GitHub App"
              />
              Through the GitHub App
            </label>
          )}
          {harnesses.length > 1 && (
            <span className="flex items-center gap-1.5">
              Default agent
              <SearchSelect
                label="Default agent"
                value={instanceId}
                onValueChange={setInstanceId}
                searchable={false}
                options={harnesses.map((h) => ({ value: h.id, label: h.label }))}
              >
                {harness?.label ?? "Pick"}
                <ChevronDown className="opacity-50" />
              </SearchSelect>
            </span>
          )}
        </div>
      </form>
    </SettingsGroup>
  );
}

function ProjectSettings({
  project,
  harnesses,
  onChange,
}: {
  project: ProjectView;
  harnesses: HarnessInfo[];
  onChange(): void;
}) {
  const update: Update = (body) =>
    void projectsApi
      .update(project.id, body)
      .then(onChange)
      .catch((e: unknown) => toast.error(errorMessage(e, "Could not save that.")));
  return (
    <>
      <ProjectHeader project={project} />
      <GeneralGroup project={project} harnesses={harnesses} update={update} />
      <InstructionsGroup project={project} update={update} />
      <ScriptsGroup project={project} update={update} />
      <PullRequestGroups project={project} update={update} />
      <LimitsGroup project={project} update={update} />
      <DangerZone project={project} onChange={onChange} />
    </>
  );
}

type Update = (body: ProjectUpdateBody) => void;

const INSTRUCTIONS_MAX = 8000;

function InstructionsGroup({ project, update }: { project: ProjectView; update: Update }) {
  const id = fieldId(project, "project-instructions");
  return (
    <SettingsGroup title="Project chat">
      <SettingsRow
        label="Instructions"
        description="Sent to the project chat and to every new thread of this project. Running threads keep what they started with."
        htmlFor={id}
        stack
      >
        <InstructionsField
          key={project.settings.instructions}
          id={id}
          value={project.settings.instructions}
          onSave={(instructions) => update({ settings: { instructions } })}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}

function InstructionsField({
  id,
  value,
  onSave,
}: {
  id: string;
  value: string;
  onSave(next: string): void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <div className="flex w-full flex-col gap-1">
      <Textarea
        id={id}
        value={draft}
        rows={5}
        maxLength={INSTRUCTIONS_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim() !== value) onSave(draft.trim());
        }}
        placeholder="Use pnpm. Merge to main once CI is green. Ask before touching migrations."
      />
      <span className="text-muted-foreground self-end text-xs">
        {draft.length.toLocaleString()} / {INSTRUCTIONS_MAX.toLocaleString()}
      </span>
    </div>
  );
}

const fieldId = (project: ProjectView, name: string) => `project-${project.id}-${name}`;

function ProjectHeader({ project }: { project: ProjectView }) {
  return (
    <div className="space-y-2 px-1">
      <Link
        to="/settings/projects"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
      >
        <ArrowLeft className="size-3.5" />
        Projects
      </Link>
      <div className="flex items-center gap-2">
        <FolderGit2 className="text-muted-foreground size-5 shrink-0" />
        <h2 className="truncate text-lg font-semibold">{project.name}</h2>
      </div>
      <p className={cn("text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs")}>
        <a
          href={`https://github.com/${project.repo.owner}/${project.repo.name}`}
          target="_blank"
          rel="noreferrer"
          className={cn("hover:text-foreground inline-flex items-center gap-1", monoClass)}
        >
          {project.repo.owner}/{project.repo.name}
          <ExternalLink className="size-3" />
        </a>
        <span>·</span>
        <span>{project.transport === "app" ? "GitHub App" : "gh or the token"}</span>
        <span>·</span>
        <span className={cn("truncate", monoClass)} title={project.checkoutPath}>
          {project.checkoutPath}
        </span>
      </p>
    </div>
  );
}

function GeneralGroup({
  project,
  harnesses,
  update,
}: {
  project: ProjectView;
  harnesses: HarnessInfo[];
  update: Update;
}) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const defaultHarness = harnesses.find((h) => h.id === project.defaultInstanceId);
  useEffect(() => {
    let cancelled = false;
    if (!defaultHarness) return;
    void loadModels(defaultHarness.id)
      .then((list) => !cancelled && setModels(list))
      .catch(() => !cancelled && setModels([]));
    return () => {
      cancelled = true;
    };
  }, [defaultHarness]);
  const model = models.find((m) => m.id === project.defaultModel);
  const field = (name: string) => fieldId(project, name);
  return (
    <SettingsGroup title="General">
      <SettingsRow label="Name" htmlFor={field("name")}>
        <TextField
          id={field("name")}
          value={project.name}
          required
          onSave={(name) => update({ name })}
        />
      </SettingsRow>
      <SettingsRow
        label="Base branch"
        description="New threads branch from it, and Changes compare against it."
        htmlFor={field("base")}
      >
        <TextField
          id={field("base")}
          value={project.baseBranch}
          required
          mono
          onSave={(baseBranch) => update({ baseBranch })}
        />
      </SettingsRow>
      <SettingsRow
        label="Branch prefix"
        description="Goes before a new thread's branch name. Leave it empty for none."
        htmlFor={field("prefix")}
      >
        <TextField
          id={field("prefix")}
          value={project.settings.branchPrefix}
          placeholder="No prefix"
          mono
          onSave={(branchPrefix) => update({ settings: { branchPrefix } })}
        />
      </SettingsRow>
      <SettingsRow label="Default agent" description="Picked for a new thread in this project.">
        <SearchSelect
          label="Default agent"
          value={project.defaultInstanceId ?? ""}
          onValueChange={(v) => update({ defaultInstanceId: v || null, defaultModel: null })}
          searchable={false}
          align="end"
          options={[
            { value: "", label: "Pick at start" },
            ...harnesses.map((h) => ({ value: h.id, label: h.label })),
          ]}
        >
          {defaultHarness?.label ?? "Pick at start"}
          <ChevronDown className="opacity-50" />
        </SearchSelect>
      </SettingsRow>
      {defaultHarness && models.length > 0 && (
        <SettingsRow label="Default model">
          <SearchSelect
            label="Default model"
            value={project.defaultModel ?? ""}
            onValueChange={(v) => update({ defaultModel: v || null })}
            align="end"
            searchPlaceholder="Search models…"
            options={[
              { value: "", label: `${defaultHarness.label}'s default` },
              ...models
                .filter((m) => m.ready !== false)
                .map((m) => ({ value: m.id, label: m.label || m.id })),
            ]}
          >
            <span className="max-w-48 truncate">
              {model ? model.label || model.id : `${defaultHarness.label}'s default`}
            </span>
            <ChevronDown className="opacity-50" />
          </SearchSelect>
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}

function ScriptsGroup({ project, update }: { project: ProjectView; update: Update }) {
  const { settings } = project;
  const field = (name: string) => fieldId(project, name);
  return (
    <SettingsGroup
      title="Scripts"
      description={
        <>
          Empty fields use the checked-in <code className={monoClass}>.tiny-agents/code.json</code>.
        </>
      }
    >
      <SettingsRow
        label="Setup script"
        description="Runs in a new worktree before the first turn."
        htmlFor={field("setup")}
      >
        <TextField
          id={field("setup")}
          value={settings.scripts.setup ?? ""}
          mono
          placeholder="pnpm install"
          onSave={(setup) => update({ settings: { scripts: { setup } } })}
        />
      </SettingsRow>
      <SettingsRow
        label="Check script"
        description="The agent runs it before it reports done."
        htmlFor={field("check")}
      >
        <TextField
          id={field("check")}
          value={settings.scripts.check ?? ""}
          mono
          placeholder="pnpm test"
          onSave={(check) => update({ settings: { scripts: { check } } })}
        />
      </SettingsRow>
      <SettingsRow
        label="Archive script"
        description="Runs before a worktree is removed."
        htmlFor={field("archive")}
      >
        <TextField
          id={field("archive")}
          value={settings.scripts.archive ?? ""}
          mono
          placeholder="rm -rf node_modules"
          onSave={(archive) => update({ settings: { scripts: { archive } } })}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}

function PullRequestGroups({ project, update }: { project: ProjectView; update: Update }) {
  const { settings } = project;
  const { autofix } = settings;
  const field = (name: string) => fieldId(project, name);
  return (
    <>
      <SettingsGroup title="Pull requests">
        <SwitchRow
          label="Open new PRs as drafts"
          description="Off opens them ready for review. Each PR's Draft switch flips it later."
          checked={settings.draftPulls}
          onChange={(draftPulls) => update({ settings: { draftPulls } })}
        />
        <SwitchRow
          label="Archive the thread when its PR merges or closes"
          checked={settings.archiveOnMerge}
          onChange={(archiveOnMerge) => update({ settings: { archiveOnMerge } })}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Auto-fix"
        description="Workflows the agent runs on a PR while you are away, in the thread's own permission mode. Each also runs by hand from its thread."
      >
        <SwitchRow
          label="Auto-fix new PRs"
          checked={autofix.onByDefault}
          onChange={(v) => update({ settings: { autofix: { onByDefault: v } } })}
        />
        <SwitchRow
          label="Fix CI"
          description="When a check fails."
          checked={autofix.triggers.checks}
          onChange={(checks) => update({ settings: { autofix: { triggers: { checks } } } })}
        />
        <SwitchRow
          label="Address review comments"
          description="From trusted reviewers only."
          checked={autofix.triggers.reviews}
          onChange={(reviews) => update({ settings: { autofix: { triggers: { reviews } } } })}
        />
        <SwitchRow
          label="Resolve conflicts"
          description="When the branch no longer merges."
          checked={autofix.triggers.conflicts}
          onChange={(conflicts) => update({ settings: { autofix: { triggers: { conflicts } } } })}
        />
        <SettingsRow
          label="Instructions for every workflow"
          description="Added to what the agent is asked, for the workflows above, Fix issue and Review PR."
          htmlFor={field("instructions")}
          stack
        >
          <TextField
            id={field("instructions")}
            value={settings.workflowInstructions}
            placeholder="Run the tests before you commit. Keep changes small."
            className="sm:w-full"
            onSave={(workflowInstructions) => update({ settings: { workflowInstructions } })}
          />
        </SettingsRow>
        <SettingsRow
          label="Trusted review bots"
          description="Their comments become instructions. Owners, members and collaborators always count."
          htmlFor={field("bots")}
          stack
        >
          <TextField
            id={field("bots")}
            value={autofix.trustedBots.join(", ")}
            placeholder="coderabbitai[bot], copilot-pull-request-reviewer[bot]"
            className="sm:w-full"
            onSave={(text) => update({ settings: { autofix: { trustedBots: list(text) } } })}
          />
        </SettingsRow>
        <SettingsRow
          label="Protected paths"
          description="A pass that changes these is not pushed. Comma-separated globs."
          htmlFor={field("protected")}
          stack
        >
          <TextField
            id={field("protected")}
            value={settings.protectedPaths.join(", ")}
            mono
            placeholder=".github/workflows/**"
            className="sm:w-full"
            onSave={(text) => update({ settings: { protectedPaths: list(text) } })}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function LimitsGroup({ project, update }: { project: ProjectView; update: Update }) {
  const { autofix } = project.settings;
  const field = (name: string) => fieldId(project, name);
  const number = (key: "hourlyLimit" | "noOwnerLimit" | "passMinutes", min: number, max: number) =>
    function save(next: string): false | void {
      const n = Number(next);
      if (!Number.isInteger(n) || n < min || n > max) {
        toast.error(`Use a whole number from ${min} to ${max}.`);
        return false;
      }
      update({ settings: { autofix: { [key]: n } } });
    };
  return (
    <SettingsGroup title="Limits">
      <SettingsRow
        label="Passes an hour"
        description="More pauses Auto-fix until someone pushes, reviews or writes."
        htmlFor={field("hourly")}
      >
        <TextField
          id={field("hourly")}
          value={String(autofix.hourlyLimit)}
          inputMode="numeric"
          className="sm:w-24"
          onSave={number("hourlyLimit", 1, 30)}
        />
      </SettingsRow>
      <SettingsRow
        label="Passes in a row without you"
        description="More switches Auto-fix off."
        htmlFor={field("owner")}
      >
        <TextField
          id={field("owner")}
          value={String(autofix.noOwnerLimit)}
          inputMode="numeric"
          className="sm:w-24"
          onSave={number("noOwnerLimit", 1, 50)}
        />
      </SettingsRow>
      <SettingsRow
        label="Minutes a pass may run"
        description="A longer pass is stopped."
        htmlFor={field("minutes")}
      >
        <TextField
          id={field("minutes")}
          value={String(autofix.passMinutes)}
          inputMode="numeric"
          className="sm:w-24"
          onSave={number("passMinutes", 5, 120)}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}

function DangerZone({ project, onChange }: { project: ProjectView; onChange(): void }) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const remove = async () => {
    const ok = await confirm({
      title: `Remove ${project.name}?`,
      description: "Its threads keep working without a project. The checkout stays on the sandbox.",
      destructive: true,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    try {
      await projectsApi.remove(project.id);
      onChange();
      navigate("/settings/projects");
    } catch (e) {
      toast.error(errorMessage(e, "Could not remove it."));
    }
  };
  return (
    <SettingsGroup title="Danger zone">
      <SettingsRow
        label="Remove project"
        description="Its threads keep working without a project. The checkout stays on the sandbox."
      >
        <Button variant="destructive" size="sm" onClick={() => void remove()}>
          <Trash2 />
          Remove
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
}

function ReviewListSettings() {
  const client = useQueryClient();
  const { data: settings } = useResource(
    INBOX_SETTINGS_KEY,
    () => reviewsApi.settings(),
    "Could not read your review list settings.",
  );
  if (!settings) {
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  }
  const save = async (change: Partial<ReviewInboxSettings>) => {
    try {
      client.setQueryData(INBOX_SETTINGS_KEY, await reviewsApi.saveSettings(change));
      void client.invalidateQueries({ queryKey: ["code", "reviews", "inbox"] });
    } catch (e) {
      toast.error(errorMessage(e, "Could not save the review list settings."));
    }
  };
  return (
    <>
      <SettingsGroup title="Show">
        <SwitchRow
          label="Only requests to you"
          description="Leave out PRs that ask a team you are on."
          checked={settings.direct}
          onChange={(direct) => void save({ direct })}
        />
        <SwitchRow
          label="Only project repositories"
          description="Leave out repositories that are not a project here."
          checked={settings.repos === "projects"}
          onChange={(on) => void save({ repos: on ? "projects" : "all" })}
        />
        <SwitchRow
          label="Drafts"
          checked={settings.drafts}
          onChange={(drafts) => void save({ drafts })}
        />
        <SwitchRow
          label="PRs by bots"
          description="Renovate, Dependabot and logins that end in -bot."
          checked={settings.bots}
          onChange={(bots) => void save({ bots })}
        />
      </SettingsGroup>
      <SettingsGroup title="Hide">
        <SettingsRow
          label="Hide PRs matching"
          description="Words in the title, or @login for an author, separated by commas."
          htmlFor="reviews-mute"
          stack
        >
          <TextField
            id="reviews-mute"
            value={settings.mute.join(", ")}
            placeholder="back-merge, @release-bot"
            className="sm:w-full"
            onSave={(next) => void save({ mute: list(next) })}
          />
        </SettingsRow>
        <SettingsRow label="Show at most" htmlFor="reviews-limit">
          <TextField
            id="reviews-limit"
            value={String(settings.limit)}
            inputMode="numeric"
            className="sm:w-24"
            required
            onSave={(next) => {
              const n = Number(next);
              if (!Number.isInteger(n) || n < 1 || n > 100) {
                toast.error("Use a whole number from 1 to 100.");
                return false;
              }
              void save({ limit: n });
            }}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

const GITHUB_KEY = ["code", "github", "status"];

function useGitHubStatus() {
  const { data } = useResource(GITHUB_KEY, () => projectsApi.github().catch(() => null), "");
  const client = useQueryClient();
  const setStatus = useCallback(
    (next: GitHubStatus) => client.setQueryData<GitHubStatus | null>(GITHUB_KEY, next),
    [client],
  );
  return { status: data, setStatus };
}

function GitHubSettings() {
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
