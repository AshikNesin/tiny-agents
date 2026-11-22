import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@groot/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
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
import { Kbd } from "./keys";

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

export function NewThreadDialog({
  open,
  onOpenChange,
  projects,
  harnesses,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  projects: ProjectView[] | null;
  harnesses: HarnessInfo[];
}) {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState<string>("");
  const [instanceId, setInstanceId] = useState<string>("");
  const [model, setModel] = useState(DEFAULT);
  const [permission, setPermission] = useState<PermissionMode | null>(null);
  const [text, setText] = useState("");
  const [starting, setStarting] = useState(false);

  const project = projects?.find((p) => p.id === projectId) ?? null;
  const harness = harnesses.find((h) => h.id === instanceId);
  const models = useModels(harness?.id);

  useEffect(() => {
    if (!open || !projects?.length) return;
    const remembered = lastProject();
    setProjectId((current) =>
      projects.some((p) => p.id === current)
        ? current
        : (projects.find((p) => p.id === remembered)?.id ?? projects[0]!.id),
    );
  }, [open, projects]);

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
      onOpenChange(false);
      navigate(threadPath(threadId));
    } catch (error) {
      toast.error(errorMessage(error, "Could not start the thread."));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="code-new-thread">
        <DialogHeader>
          <DialogTitle>New thread</DialogTitle>
          <DialogDescription>
            The agent works on its own branch of the project, in its own worktree.
          </DialogDescription>
        </DialogHeader>
        {projects && projects.length === 0 ? (
          <p className="text-sm">
            A thread needs a project.{" "}
            <Link
              to="/code/settings/projects"
              className="underline underline-offset-2"
              onClick={() => onOpenChange(false)}
            >
              Add a repository
            </Link>{" "}
            first.
          </p>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void start();
            }}
          >
            <div className="flex flex-wrap items-center gap-1.5">
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
                <ModelPicker models={models} value={model} onChange={setModel} withDefault bare />
              )}
              {harness && permission && (
                <PermissionPicker
                  modes={harness.capabilities.settings.permissionModes}
                  value={permission}
                  onChange={setPermission}
                />
              )}
            </div>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                void start();
              }}
              autoFocus
              rows={4}
              aria-label="What should the agent do?"
              placeholder="What should the agent do?"
              className="border-input bg-background placeholder:text-fg-tertiary focus-visible:ring-ring/50 w-full resize-none rounded-xl border px-3 py-2 text-sm outline-none focus-visible:ring-2"
              data-testid="code-new-message"
            />
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground flex flex-1 items-center gap-1.5 text-xs">
                <Kbd keys="enter" /> start
                <Kbd keys="shift+enter" className="ml-2" /> new line
              </span>
              <Button type="submit" disabled={starting || !text.trim() || !project || !harness}>
                {starting && <Spinner />}
                Start
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
