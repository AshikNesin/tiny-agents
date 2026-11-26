import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, ArrowUp } from "lucide-react";
import { Button } from "@groot/ui";
import { SearchSelect } from "../../components/ui/search-select";
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
import { Kbd } from "../../components/keys";

const PROJECT_KEY = "tiny-agents:code-project";

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
  const [chosenProject, setProjectId] = useState<string>("");
  const [instanceId, setInstanceId] = useState<string>("");
  const [model, setModel] = useState(DEFAULT);
  const [permission, setPermission] = useState<PermissionMode | null>(null);
  const [text, setText] = useState("");
  const [starting, setStarting] = useState(false);
  const [remembered] = useState(lastProject);

  const projectId =
    projects?.find((p) => p.id === chosenProject)?.id ??
    projects?.find((p) => p.id === remembered)?.id ??
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
    try {
      const { threadId } = await codeApi.create({
        projectId: project.id,
        instanceId: harness.id,
        message,
        ...(model !== DEFAULT ? { model } : {}),
        ...(permission ? { permissionMode: permission } : {}),
      });
      rememberProject(project.id);
      setText("");
      navigate(threadPath(threadId));
    } catch (error) {
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
        <div className="w-full max-w-2xl space-y-3">
          <div className="space-y-1 px-1">
            <h1 className="text-lg font-semibold">New thread</h1>
            <p className="text-muted-foreground text-sm">
              The agent works on its own branch of the project, in its own worktree. Paste a link to
              one of the project's issues to have it fixed.
            </p>
          </div>
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
                placeholder="What should the agent do?"
                className="placeholder:text-fg-tertiary field-sizing-content max-h-60 min-h-[4.5rem] w-full resize-none overflow-y-auto bg-transparent px-2 pt-1.5 text-base leading-7 outline-none md:text-sm md:leading-6"
                data-testid="code-new-message"
              />
              <div className="flex items-center gap-1.5">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <SearchSelect
                    label="Project"
                    value={projectId}
                    onValueChange={setProjectId}
                    options={(projects ?? []).map((p) => ({
                      value: p.id,
                      label: p.name,
                      description: `${p.repo.owner}/${p.repo.name}`,
                    }))}
                    searchable={(projects?.length ?? 0) > 6}
                    data-testid="code-new-project"
                  />
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
          <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 px-1 text-xs pointer-coarse:hidden">
            <Kbd keys="enter" /> starts it, <Kbd keys="shift+enter" /> new line, <Kbd keys="j" />{" "}
            and <Kbd keys="k" /> move through the list, <Kbd keys="?" /> shows every key.
          </p>
        </div>
      </div>
    </div>
  );
}
