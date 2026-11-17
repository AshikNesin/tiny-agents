/**
 * Shared pieces of the Code page (issue #143, ADR 0011): the composer's
 * model, effort and permission pickers (searchable; their options come from
 * the harness), the context ring, and archiving a thread with its subagents
 * (with Undo).
 */
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Brain, ChevronDown, Cpu, GitMerge, GitPullRequest, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@groot/ui/lib/utils";
import {
  SearchSelect,
  searchSelectTriggerClass,
  type SearchSelectOption,
} from "../../components/ui/search-select";
import { errorMessage } from "../../lib/errors";
import {
  codeApi,
  threadPath,
  type ModelOption,
  type PermissionMode,
  type ThreadSummary,
} from "../../lib/code/api";
import { UsagePopover } from "./UsagePopover";

const modelsByHarness = new Map<string, Promise<ModelOption[]>>();
/** A harness's models, read once per page load. */
export function loadModels(instanceId: string): Promise<ModelOption[]> {
  let promise = modelsByHarness.get(instanceId);
  if (!promise) {
    promise = codeApi.models(instanceId).catch((error: unknown) => {
      modelsByHarness.delete(instanceId);
      throw error;
    });
    modelsByHarness.set(instanceId, promise);
  }
  return promise;
}

export const DEFAULT = "default";

function modelLabel(model: ModelOption | undefined, fallback = ""): string {
  return model?.label || model?.id || fallback;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  return `${Math.round(n / 1000)}k`;
}

/** Searchable model picker; `withDefault` adds "Default" (the harness's choice). */
export function ModelPicker({
  models,
  value,
  onChange,
  withDefault,
  bare,
}: {
  models: ModelOption[];
  value: string;
  onChange(value: string): void;
  withDefault?: boolean;
  /** Text only, no icon or chevron: half of the composer's "Model · Reasoning" label. */
  bare?: boolean;
}) {
  const ready = models.filter((m) => m.ready !== false || m.id === value);
  const harnessDefault = models.find((m) => m.isDefault);
  const options: SearchSelectOption[] = [
    ...(withDefault
      ? [
          {
            value: DEFAULT,
            label: "Default",
            description: harnessDefault ? modelLabel(harnessDefault) : "The harness's default",
            keywords: ["default"],
          },
        ]
      : []),
    ...ready
      .filter((m) => !(withDefault && m.id === DEFAULT))
      .map((m) => ({
        value: m.id,
        label: modelLabel(m),
        description: [
          m.label && m.label !== m.id ? m.id : undefined,
          m.contextWindow ? `${formatTokens(m.contextWindow)} context` : undefined,
          m.isDefault ? "default" : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
        keywords: [m.id],
      })),
  ];
  const current =
    value === DEFAULT
      ? withDefault
        ? harnessDefault
          ? modelLabel(harnessDefault)
          : "Default model"
        : "Model"
      : modelLabel(
          models.find((m) => m.id === value),
          value || "Model",
        );
  return (
    <SearchSelect
      label="Model"
      value={value}
      onValueChange={onChange}
      options={options}
      searchPlaceholder="Search models…"
      emptyText="No model matches."
      side="top"
      contentClassName="w-80"
      data-testid="code-model"
    >
      {!bare && <Cpu className="opacity-70" />}
      <span className="max-w-24 truncate @xs:max-w-40">{current}</span>
      {!bare && <ChevronDown className="opacity-50" />}
    </SearchSelect>
  );
}

const LEVEL_LABEL: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

const LEVEL_HINT: Record<string, string> = {
  off: "No extended thinking",
  low: "Quick",
  medium: "Balanced",
  high: "Thorough",
  max: "As much as the model allows",
};

/** Searchable reasoning picker over the harness's levels ("default" = the model's default). */
export function ReasoningPicker({
  levels,
  value,
  onChange,
  bare,
}: {
  levels: string[];
  value: string;
  onChange(value: string): void;
  bare?: boolean;
}) {
  if (levels.length === 0) return null;
  const options: SearchSelectOption[] = [
    { value: DEFAULT, label: "Auto", description: "The model's default reasoning" },
    ...levels.map((level) => ({
      value: level,
      label: LEVEL_LABEL[level] ?? level,
      description: LEVEL_HINT[level],
      keywords: [level],
    })),
  ];
  const current = value && value !== DEFAULT ? (LEVEL_LABEL[value] ?? value) : undefined;
  return (
    <SearchSelect
      label="Reasoning"
      value={value || DEFAULT}
      onValueChange={onChange}
      options={options}
      searchPlaceholder="Search reasoning…"
      side="top"
      contentClassName="w-64"
      data-testid="code-reasoning"
    >
      {!bare && <Brain className="opacity-70" />}
      <span className={cn("truncate", !bare && "hidden @[16rem]:inline")}>{current ?? "Auto"}</span>
      {!bare && <ChevronDown className="opacity-50" />}
    </SearchSelect>
  );
}

const MODE_LABEL: Record<PermissionMode, string> = {
  default: "Ask",
  acceptEdits: "Accept edits",
  plan: "Plan",
  bypassPermissions: "Bypass",
};

const MODE_HINT: Record<PermissionMode, string> = {
  default: "Ask before edits and commands",
  acceptEdits: "Edit files without asking; ask before commands",
  plan: "Read and plan only; no edits",
  bypassPermissions: "Never ask (YOLO)",
};

/** Permission mode, for harnesses that enforce one (never offered otherwise). */
export function PermissionPicker({
  modes,
  value,
  onChange,
}: {
  modes: PermissionMode[];
  value: PermissionMode;
  onChange(value: PermissionMode): void;
}) {
  if (modes.length === 0) return null;
  return (
    <SearchSelect
      label="Permissions"
      value={value}
      onValueChange={(v) => onChange(v as PermissionMode)}
      options={modes.map((mode) => ({
        value: mode,
        label: MODE_LABEL[mode],
        description: MODE_HINT[mode],
        keywords: [mode],
      }))}
      side="top"
      contentClassName="w-72"
      data-testid="code-permission"
    >
      <ShieldCheck className="opacity-70" />
      <span className="hidden truncate @[16rem]:inline">{MODE_LABEL[value]}</span>
      <ChevronDown className="opacity-50" />
    </SearchSelect>
  );
}

/** How full the context window is; click for the usage popup (compaction
 *  lives there, as in Shelley's own UI). */
export function ContextRing({
  used,
  max,
  onCompact,
  threadId,
  usage,
  hasSubagents,
}: {
  used: number;
  max?: number;
  onCompact?: () => void;
  threadId?: string;
  /** The harness can report usage in detail (the popup). */
  usage: boolean;
  hasSubagents?: boolean;
}) {
  if (!max || !used) return null;
  const ratio = Math.min(1, used / max);
  const pct = Math.round(ratio * 100);
  const r = 6;
  const circumference = 2 * Math.PI * r;
  const ring = (
    <button
      type="button"
      title={`Context ${used.toLocaleString()} of ${max.toLocaleString()} tokens (${pct}%).${usage ? " Click for usage." : ""}`}
      aria-label={`Context ${pct}% full${usage ? ". Usage" : ""}`}
      aria-haspopup={usage ? "dialog" : undefined}
      className={cn(searchSelectTriggerClass, "tabular-nums")}
      data-testid="code-context"
    >
      <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden>
        <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2" className="stroke-muted" />
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className={cn(
            pct > 85 ? "stroke-destructive" : pct > 65 ? "stroke-warning" : "stroke-foreground/70",
          )}
        />
      </svg>
      <span className="hidden @[20rem]:inline">{pct}%</span>
    </button>
  );
  if (!usage || !threadId) return ring;
  return (
    <UsagePopover
      used={used}
      max={max}
      threadId={threadId}
      hasSubagents={Boolean(hasSubagents)}
      onCompact={onCompact}
    >
      {ring}
    </UsagePopover>
  );
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * Archive (or restore) several threads at once (issue #148), each with its
 * subagents, with one Undo for all of them. Resolves to the ids that moved
 * (the rows themselves); a thread that failed stays where it was and the
 * toast says how many did. `leave` navigates away after an archive.
 */
export function useArchiveMany() {
  const navigate = useNavigate();
  return useCallback(
    async (
      rows: Pick<ThreadSummary, "id" | "title">[],
      archive: boolean,
      options: { leave?: boolean } = {},
    ): Promise<string[]> => {
      if (rows.length === 0) return [];
      const settled = await Promise.allSettled(rows.map((row) => codeApi.archive(row.id, archive)));
      const done: string[] = [];
      let subagents = 0;
      settled.forEach((result, i) => {
        if (result.status !== "fulfilled") return;
        done.push(rows[i]!.id);
        subagents += result.value?.moved?.length ?? 0;
      });
      const failed = rows.length - done.length;
      if (failed > 0) {
        const first = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
        toast.error(`Could not ${archive ? "archive" : "restore"} ${plural(failed, "thread")}.`, {
          description: errorMessage(first?.reason, "Try again."),
        });
      }
      if (done.length === 0) return [];
      if (archive && options.leave) navigate("/code");
      const what =
        plural(done.length, "thread") + (subagents ? ` and ${plural(subagents, "subagent")}` : "");
      toast.success(archive ? `Archived ${what}` : `Restored ${what}`, {
        action: {
          label: "Undo",
          onClick: () =>
            void Promise.all(done.map((id) => codeApi.archive(id, !archive))).catch(
              (error: unknown) => toast.error(errorMessage(error, "Could not undo.")),
            ),
        },
      });
      return done;
    },
    [navigate],
  );
}

/**
 * Archive (or restore) a thread with its subagents, with Undo. `leave`
 * navigates away from it after an archive.
 */
export function useArchive() {
  const navigate = useNavigate();
  return useCallback(
    async (
      row: Pick<ThreadSummary, "id" | "title">,
      archive: boolean,
      options: { leave?: boolean } = {},
    ) => {
      const { id, title } = row;
      try {
        const result = await codeApi.archive(id, archive);
        const moved = result?.moved?.length ?? 0;
        const what = `“${title}”${moved ? ` and ${moved} ${moved === 1 ? "subagent" : "subagents"}` : ""}`;
        if (archive && options.leave) navigate("/code");
        toast.success(archive ? `Archived ${what}` : `Restored ${what}`, {
          action: {
            label: "Undo",
            onClick: () =>
              void codeApi
                .archive(id, !archive)
                .catch((error: unknown) => toast.error(errorMessage(error, "Could not undo.")))
                .then(() => {
                  if (archive && options.leave) navigate(threadPath(id));
                }),
          },
        });
        return true;
      } catch (error) {
        toast.error(errorMessage(error, `Could not ${archive ? "archive" : "restore"} it.`));
        return false;
      }
    },
    [navigate],
  );
}

/** What a thread's pull request is waiting on, in a word or two (null: nothing to say). */
export function pullState(loop: string): string | null {
  switch (loop) {
    case "needs_input":
      return "needs you";
    case "fixing":
      return "fixing";
    case "merged":
      return "merged";
    case "green":
      return "checks pass";
    default:
      return null;
  }
}

const PULL_TONE: Record<string, string> = {
  needs_input: "text-warning",
  fixing: "text-foreground",
  green: "text-success",
};

/** A thread's pull request as a small chip: its number, toned by what it waits on. */
export function PullChip({
  pr,
  className,
}: {
  pr: { number: number; loop: string };
  className?: string;
}) {
  const state = pullState(pr.loop);
  const Icon = pr.loop === "merged" ? GitMerge : GitPullRequest;
  return (
    <span
      aria-label={`Pull request #${pr.number}${state ? `, ${state}` : ""}`}
      title={`Pull request #${pr.number}${state ? ` (${state})` : ""}`}
      className={cn(
        "bg-muted inline-flex h-5 shrink-0 items-center gap-0.5 rounded-md px-1 text-[11px] font-medium tabular-nums",
        PULL_TONE[pr.loop] ?? "text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />#{pr.number}
    </span>
  );
}
