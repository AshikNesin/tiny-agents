import { useEffect, useMemo, useState } from "react";
import type { CodeSettingsSectionId } from "../settings/sections";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, FolderGit2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, Input, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { SearchSelect } from "@groot/ui/search-select";
import { Spinner } from "../../components/ui/spinner";
import { Switch } from "@groot/ui/switch";
import { errorMessage } from "../../lib/errors";
import { projectsApi, useProjects } from "../../lib/code/projects";
import { useBotsStore } from "../../store/bots";
import { useCodeStore } from "../../store/code";
import { RESOURCE_QUERY } from "../../queries/resource";
import type { HarnessInfo } from "../../lib/code/api";
import { useViewer, viewerRole } from "../../queries/viewer";
import type { ProjectView } from "../../../shared/api/code";
import { GitHubSettings, useGitHubStatus } from "./GitHubSettings";
import { ProjectSettings } from "./ProjectSettings";
import { ReviewListSettings } from "./ReviewListSettings";
import { SettingsGroup } from "./SettingsRows";

export const projectSettingsPath = (id: string) =>
  `/settings/projects?project=${encodeURIComponent(id)}`;

export function CodeSettingsSection({ section }: { section: CodeSettingsSectionId }) {
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
  const role = viewerRole(useViewer());
  if (role === "loading" || role === "unknown") {
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
  const openChat = async (projectId: string) => {
    try {
      useBotsStore.getState().adoptBot(await projectsApi.openChat(projectId));
    } catch (e) {
      toast.error(errorMessage(e, "Could not make the project's chat."));
    }
  };
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
      if (useBotsStore.getState().models.length > 0) void openChat(created.id);
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
