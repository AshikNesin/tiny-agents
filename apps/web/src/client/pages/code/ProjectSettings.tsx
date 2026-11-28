import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown, ExternalLink, FolderGit2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, monoClass } from "@groot/ui";
import { useConfirm } from "@groot/ui/primitives";
import { Textarea } from "@groot/ui/textarea";
import { cn } from "@groot/ui/lib/utils";
import { SearchSelect } from "@groot/ui/search-select";
import { errorMessage } from "../../lib/errors";
import { projectsApi } from "../../lib/code/projects";
import type { HarnessInfo } from "../../lib/code/api";
import type { ProjectUpdateBody, ProjectView } from "../../../shared/api/code";
import { useHarnessModels } from "./controls";
import { SettingsGroup, SettingsRow, SwitchRow, TextField, list } from "./SettingsRows";

export function ProjectSettings({
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
  const defaultHarness = harnesses.find((h) => h.id === project.defaultInstanceId);
  const models = useHarnessModels(defaultHarness?.id);
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
