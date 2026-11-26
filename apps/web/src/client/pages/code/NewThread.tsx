import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, ArrowUp, ChevronDown, FolderGit2 } from "lucide-react";
import { Button } from "@groot/ui";
import { SearchSelect, type SearchSelectOption } from "../../components/ui/search-select";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import {
  codeApi,
  threadPath,
  type HarnessInfo,
  type ModelOption,
  type PermissionMode,
} from "../../lib/code/api";
import type { ProjectView } from "../../../shared/api/code";
import { DEFAULT, ModelPicker, PermissionPicker, composerPermission, loadModels } from "./controls";
import { useCodeStore } from "../../store/code";
import { useUiStore } from "../../store/ui";

const PROJECT_KEY = "tiny-agents:code-project";
const RECENT_PROJECTS = 5;

const storageIsBlockedInPrivateWindows = (): void => undefined;

function lastProject(): string | null {
  try {
    return localStorage.getItem(PROJECT_KEY);
  } catch {
    storageIsBlockedInPrivateWindows();
    return null;
  }
}

function rememberProject(id: string): void {
  try {
    localStorage.setItem(PROJECT_KEY, id);
  } catch {
    storageIsBlockedInPrivateWindows();
  }
}

function useModels(instanceId: string | undefined): ModelOption[] {
  const [models, setModels] = useState<ModelOption[]>([]);
  useEffect(() => {
    setModels([]);
    if (!instanceId) return;
    let live = true;
    void loadModels(instanceId)
      .then((list) => live && setModels(list))
      .catch((error: unknown) => toast.error(errorMessage(error, "Could not load the models.")));
    return () => {
      live = false;
    };
  }, [instanceId]);
  return models;
}

function useProjectOptions(projects: ProjectView[] | null): {
  options: SearchSelectOption[];
  latest: string | undefined;
} {
  const threads = useCodeStore((s) => s.threads);
  const ranked = useMemo(() => {
    const lastUsed = new Map<string, string>();
    for (const thread of threads ?? []) {
      if (!thread.projectId) continue;
      const seen = lastUsed.get(thread.projectId);
      if (!seen || thread.updatedAt > seen) lastUsed.set(thread.projectId, thread.updatedAt);
    }
    const all = projects ?? [];
    const recent = all
      .flatMap((p) => {
        const at = lastUsed.get(p.id);
        return at ? [{ p, at }] : [];
      })
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, RECENT_PROJECTS)
      .map(({ p }) => p);
    const rest = all.filter((p) => !recent.includes(p));
    const grouped = recent.length > 0 && rest.length > 0;
    const option = (p: ProjectView, group: string): SearchSelectOption => ({
      value: p.id,
      label: p.name,
      description: `${p.repo.owner}/${p.repo.name}`,
      ...(grouped ? { group } : {}),
    });
    return {
      options: [
        ...recent.map((p) => option(p, "Recent")),
        ...rest.map((p) => option(p, "Projects")),
      ],
      latest: recent[0]?.id,
    };
  }, [projects, threads]);
  const loaded = projects !== null && threads !== null;
  const [latest, setLatest] = useState<string | null>(null);
  if (loaded && latest === null) setLatest(ranked.latest ?? "");
  return { options: ranked.options, latest: latest || undefined };
}

export function NewThread({
  focused,
  projects,
  harnesses,
}: {
  focused: boolean;
  projects: ProjectView[] | null;
  harnesses: HarnessInfo[];
}) {
  const navigate = useNavigate();
  const box = useRef<HTMLTextAreaElement>(null);
  const [instanceId, setInstanceId] = useState<string>("");
  const [model, setModel] = useState(DEFAULT);
  const [permission, setPermission] = useState<PermissionMode | null>(null);
  const { text, projectId: chosenProject } = useUiStore((s) => s.newThreadDraft);
  const setDraft = useUiStore((s) => s.setNewThreadDraft);
  const setText = (next: string) => setDraft({ text: next });
  const setProjectId = (next: string) => setDraft({ projectId: next });
  const [starting, setStarting] = useState(false);
  const [remembered] = useState(lastProject);

  const { options: projectOptions, latest } = useProjectOptions(projects);
  const projectId =
    projects?.find((p) => p.id === chosenProject)?.id ??
    projects?.find((p) => p.id === remembered)?.id ??
    latest ??
    projects?.[0]?.id ??
    "";
  const project = projects?.find((p) => p.id === projectId) ?? null;
  const harness = harnesses.find((h) => h.id === instanceId);
  const models = useModels(harness?.id);

  useEffect(() => {
    if (focused) box.current?.focus();
  }, [focused, projects]);

  useEffect(() => {
    if (!project) return;
    const preferred = harnesses.find((h) => h.id === project.defaultInstanceId) ?? harnesses[0];
    setInstanceId(preferred?.id ?? "");
    setModel(project.defaultModel ?? DEFAULT);
  }, [project, harnesses]);

  useEffect(() => {
    setPermission(harness ? composerPermission(harness.capabilities.settings) : null);
  }, [harness]);

  const start = async () => {
    const message = text.trim();
    if (!message || !project || !harness || starting) return;
    setStarting(true);
    setText("");
    try {
      const { threadId } = await codeApi.create({
        projectId: project.id,
        instanceId: harness.id,
        message,
        ...(model !== DEFAULT ? { model } : {}),
        ...(permission ? { permissionMode: permission } : {}),
      });
      rememberProject(project.id);
      setDraft({ projectId: "" });
      navigate(threadPath(threadId));
    } catch (error) {
      if (!useUiStore.getState().newThreadDraft.text) setText(message);
      toast.error(errorMessage(error, "Could not start the thread."));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="code-new-thread">
      <header className="flex h-13 shrink-0 items-center px-2 lg:hidden">
        <Button asChild variant="ghost" size="icon-sm" aria-label="All threads">
          <Link to="/code">
            <ArrowLeft />
          </Link>
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 pb-[12vh]">
        <div className="w-full max-w-2xl">
          {projects && projects.length === 0 ? (
            <p className="px-1 text-sm">
              A thread needs a project.{" "}
              <Link to="/settings/projects" className="underline underline-offset-2">
                Add a repository
              </Link>{" "}
              first.
            </p>
          ) : (
            <form
              className="bg-composer flex flex-col gap-1 rounded-3xl p-2"
              onSubmit={(event) => {
                event.preventDefault();
                void start();
              }}
            >
              <textarea
                ref={box}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
                    return;
                  event.preventDefault();
                  void start();
                }}
                rows={3}
                aria-label="What should the agent do?"
                placeholder="What should the agent do? Paste an issue link to have it fixed."
                className="placeholder:text-fg-tertiary field-sizing-content max-h-60 min-h-[4.5rem] w-full resize-none overflow-y-auto bg-transparent px-2 pt-1.5 text-base leading-7 outline-none md:text-sm md:leading-6"
                data-testid="code-new-message"
              />
              <div className="flex items-center gap-1.5">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <SearchSelect
                    label="Project"
                    value={projectId}
                    onValueChange={setProjectId}
                    options={projectOptions}
                    searchPlaceholder="Choose a project…"
                    emptyText="No project matches."
                    inlineDescriptions
                    contentClassName="w-96"
                    data-testid="code-new-project"
                  >
                    <FolderGit2 />
                    <span className="truncate">{project?.name ?? "Project"}</span>
                    <ChevronDown className="opacity-60" />
                  </SearchSelect>
                  {harnesses.length > 1 && (
                    <SearchSelect
                      label="Agent"
                      value={instanceId}
                      onValueChange={setInstanceId}
                      options={harnesses.map((h) => ({ value: h.id, label: h.label }))}
                      searchable={false}
                      data-testid="code-new-agent"
                    />
                  )}
                  {harness?.capabilities.settings.modelSwitch && models.length > 0 && (
                    <ModelPicker
                      models={models}
                      value={model}
                      onChange={setModel}
                      withDefault
                      bare
                    />
                  )}
                  {harness && permission && (
                    <PermissionPicker
                      modes={harness.capabilities.settings.permissionModes}
                      value={permission}
                      onChange={setPermission}
                    />
                  )}
                </div>
                <Button
                  type="submit"
                  size="icon-sm"
                  className="shrink-0 rounded-full"
                  aria-label="Start"
                  disabled={starting || !text.trim() || !project || !harness}
                >
                  {starting ? <Spinner /> : <ArrowUp />}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
